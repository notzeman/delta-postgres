import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { config } from "./config";
import { getSettings, type Project, type ServerRow } from "./db";
import {
  runCommand,
  spawnStream,
  ensureDir,
  fileExists,
  dirSizeBytes,
  parseJsonSafe,
  rmrf,
} from "./utils";
import {
  execCapture,
  copyFileToContainer,
  getContainer,
} from "./docker";

export interface BorgArchiveStats {
  name: string;
  start: string | null;
  end: string | null;
  originalSize: number;
  compressedSize: number;
  deduplicatedSize: number;
  fileCount: number;
}

export type LogFn = (line: string) => void;

export function borgEnv(project?: Project): NodeJS.ProcessEnv {
  const slug = project?.slug || "_shared";
  const borgBase = path.join(config.dataDir, "borg", slug);
  for (const sub of ["cache", "config", "keys", "security"]) {
    ensureDir(path.join(borgBase, sub));
  }
  return {
    HOME: config.dataDir,
    BORG_BASE_DIR: borgBase,
    BORG_CACHE_DIR: path.join(borgBase, "cache"),
    BORG_CONFIG_DIR: path.join(borgBase, "config"),
    BORG_KEYS_DIR: path.join(borgBase, "keys"),
    BORG_SECURITY_DIR: path.join(borgBase, "security"),
    BORG_PASSPHRASE: config.borgPassphrase,
    BORG_RELOCATED_REPO_ACCESS_IS_OK: "yes",
    BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK: "yes",
    BORG_CHECK_I_KNOW_WHAT_I_AM_DOING: "YES",
    BORG_DELETE_I_KNOW_WHAT_I_AM_DOING: "YES",
    BORG_EXIT_CODES: "modern",
    LANG: "C.UTF-8",
    TZ: process.env.TZ || config.timezone,
  };
}

export function projectBackupDir(project: Project): string {
  if (project.server_slug && project.server_slug !== "local") {
    return path.join(config.backupRoot, "servers", project.server_slug, project.slug);
  }
  return path.join(config.backupRoot, project.slug);
}

export function repoPath(project: Project): string {
  return path.join(projectBackupDir(project), "repo");
}

export async function borgVersion(): Promise<string> {
  try {
    const result = await runCommand("borg", ["--version"]);
    return result.stdout.trim() || result.stderr.trim();
  } catch {
    return "not installed";
  }
}

export async function ensureRepo(project: Project, log: LogFn): Promise<string> {
  const repo = repoPath(project);
  ensureDir(path.dirname(repo));
  let needsInit = !fileExists(path.join(repo, "config"));
  if (!needsInit) {
    // Guard against an incomplete init left behind by a previous crash.
    const check = await runCommand("borg", ["info", "--json", repo], {
      env: borgEnv(project),
    });
    if (check.code !== 0) {
      const message = `${check.stderr}\n${check.stdout}`;
      if (/no manifest|invalid repository|does not exist/i.test(message)) {
        log("Removing incomplete Borg repository and re-initializing");
        rmrf(repo);
        needsInit = true;
      } else {
        throw new Error(check.stderr.trim() || "Borg repository is not accessible");
      }
    }
  }
  if (needsInit) {
    log(`Initializing Borg repository at ${repo}`);
    const result = await runCommand(
      "borg",
      ["init", "--encryption=repokey-blake2", "--make-parent-dirs", repo],
      { env: borgEnv(project), onLine: (line) => log(line) },
    );
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "borg init failed");
    }
  } else {
    log(`Using existing Borg repository at ${repo}`);
  }
  return repo;
}

function archiveRef(project: Project, name?: string): string {
  const repo = repoPath(project);
  return name ? `${repo}::${name}` : repo;
}

export async function createArchive(
  project: Project,
  stagingDir: string,
  archiveName: string,
  log: LogFn,
): Promise<BorgArchiveStats> {
  await ensureRepo(project, log);
  const args = [
    "create",
    "--stats",
    "--json",
    "--compression",
    project.compression || "auto,zstd,3",
    archiveRef(project, archiveName),
    ".",
  ];
  log(`Creating Borg archive ${archiveName}`);
  const result = await runCommand("borg", args, {
    cwd: stagingDir,
    env: borgEnv(project),
    onLine: (line) => log(line),
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "borg create failed");
  }
  const parsed = parseJsonSafe<any>(result.stdout, {});
  const archive = parsed?.archive || parsed?.archives?.[0] || {};
  const stats = archive.stats || parsed?.stats || {};
  return {
    name: archiveName,
    start: archive.start || null,
    end: archive.end || null,
    originalSize: Number(stats.original_size || 0),
    compressedSize: Number(stats.compressed_size || 0),
    deduplicatedSize: Number(stats.deduplicated_size || 0),
    fileCount: Number(stats.nfiles || 0),
  };
}

export async function pruneArchive(
  project: Project,
  log: LogFn,
): Promise<void> {
  const settings = await getSettings();
  const keepDaily =
    project.keep_daily ?? Number(settings.keepDaily ?? config.keepDaily);
  const keepWeekly =
    project.keep_weekly ?? Number(settings.keepWeekly ?? config.keepWeekly);
  const keepMonthly =
    project.keep_monthly ?? Number(settings.keepMonthly ?? config.keepMonthly);
  const args = ["prune", "--list", "--stats"];
  if (keepDaily > 0) args.push("--keep-daily", String(keepDaily));
  if (keepWeekly > 0) args.push("--keep-weekly", String(keepWeekly));
  if (keepMonthly > 0) args.push("--keep-monthly", String(keepMonthly));
  if (keepDaily <= 0 && keepWeekly <= 0 && keepMonthly <= 0) {
    args.push("--keep-last", "7");
  }
  args.push(archiveRef(project));
  log(`Pruning archives (daily=${keepDaily}, weekly=${keepWeekly}, monthly=${keepMonthly})`);
  const result = await runCommand("borg", args, {
    env: borgEnv(project),
    onLine: (line) => log(line),
  });
  if (result.code !== 0) {
    log(`Warning: borg prune failed: ${result.stderr.trim()}`);
  }
  log("Compacting repository");
  const compact = await runCommand("borg", ["compact", archiveRef(project)], {
    env: borgEnv(project),
    onLine: (line) => log(line),
  });
  if (compact.code !== 0) {
    log(`Warning: borg compact failed: ${compact.stderr.trim()}`);
  }
}

export interface ListedArchive {
  name: string;
  start: string | null;
  end: string | null;
}

export async function listArchives(project: Project): Promise<ListedArchive[]> {
  await ensureRepo(project, () => {});
  const result = await runCommand("borg", ["list", "--json", archiveRef(project)], {
    env: borgEnv(project),
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "borg list failed");
  }
  const parsed = parseJsonSafe<any>(result.stdout, {});
  const archives = parsed?.archives || [];
  return archives.map((a: any) => ({
    name: a.name || a.archive || a.barchive,
    start: a.start || a.time || null,
    end: a.end || null,
  }));
}

export async function archiveInfo(
  project: Project,
  name: string,
): Promise<BorgArchiveStats> {
  const result = await runCommand(
    "borg",
    ["info", "--json", archiveRef(project, name)],
    { env: borgEnv(project) },
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "borg info failed");
  }
  const parsed = parseJsonSafe<any>(result.stdout, {});
  const archive = parsed?.archives?.[0] || {};
  const stats = archive.stats || {};
  return {
    name,
    start: archive.start || null,
    end: archive.end || null,
    originalSize: Number(stats.original_size || 0),
    compressedSize: Number(stats.compressed_size || 0),
    deduplicatedSize: Number(stats.deduplicated_size || 0),
    fileCount: Number(stats.nfiles || 0),
  };
}

export async function listArchiveFiles(
  project: Project,
  name: string,
): Promise<Array<{ path: string; size: number; type: string }>> {
  const result = await runCommand(
    "borg",
    [
      "list",
      "--format",
      "{type}|{size}|{path}{NEWLINE}",
      archiveRef(project, name),
    ],
    { env: borgEnv(project) },
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "borg list failed");
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawType, rawSize, ...pathParts] = line.split("|");
      const typeMap: Record<string, string> = {
        "-": "file",
        d: "directory",
        l: "symlink",
      };
      return {
        path: pathParts.join("|"),
        size: Number(rawSize) || 0,
        type: typeMap[rawType] || rawType,
      };
    });
}

export async function deleteArchive(project: Project, name: string): Promise<void> {
  const result = await runCommand(
    "borg",
    ["delete", "--stats", archiveRef(project, name)],
    { env: borgEnv(project) },
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "borg delete failed");
  }
}

export async function checkArchive(
  project: Project,
  name: string | undefined,
  log: LogFn,
): Promise<void> {
  const args = ["check", "--verify-data"];
  if (name) args.push(archiveRef(project, name));
  else args.push(archiveRef(project));
  const result = await runCommand("borg", args, {
    env: borgEnv(project),
    onLine: (line) => log(line),
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "borg check failed");
  }
}

export function exportArchiveStream(project: Project, name: string) {
  return spawnStream(
    "borg",
    ["export-tar", archiveRef(project, name), "-"],
    { env: borgEnv(project) },
  );
}

export function exportRepoStream(project: Project) {
  const root = projectBackupDir(project);
  return spawn("tar", ["-cf", "-", "-C", root, "."], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function exportAllStream() {
  return spawn("tar", ["-cf", "-", "-C", config.backupRoot, "."], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function importArchiveFromFile(
  project: Project,
  name: string,
  filePath: string,
  log: LogFn,
): Promise<void> {
  await ensureRepo(project, log);
  log(`Importing archive ${name} from ${path.basename(filePath)}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "borg",
      ["import-tar", archiveRef(project, name), "-"],
      { env: { ...process.env, ...borgEnv(project) }, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      for (const line of c.toString("utf8").split(/\r?\n/)) if (line.trim()) log(line);
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
      for (const line of c.toString("utf8").split(/\r?\n/)) if (line.trim()) log(line);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `borg import-tar failed (${code})`));
    });
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.pipe(child.stdin);
  });
}

export async function extractArchiveFile(
  project: Project,
  archive: string,
  memberPath: string,
  destFile: string,
  log: LogFn,
): Promise<void> {
  log(`Extracting ${memberPath} from ${archive}`);
  const runExtract = (pathToExtract: string) =>
    new Promise<number>((resolve, reject) => {
      const child = spawn(
        "borg",
        ["extract", "--stdout", archiveRef(project, archive), pathToExtract],
        { env: { ...process.env, ...borgEnv(project) }, stdio: ["ignore", "pipe", "pipe"] },
      );
      const out = fs.createWriteStream(destFile);
      let stderr = "";
      child.stdout.pipe(out);
      child.stderr.on("data", (c: Buffer) => {
        stderr += c.toString("utf8");
        for (const line of c.toString("utf8").split(/\r?\n/)) if (line.trim()) log(line);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        out.end(() => {
          if (code === 0) resolve(code);
          else reject(new Error(stderr.trim() || `borg extract failed (${code})`));
        });
      });
    });

  try {
    await runExtract(memberPath);
  } catch (firstError) {
    // Borg may preserve a leading "./" depending on how the archive was created.
    if (!memberPath.startsWith("./")) {
      await runExtract(`./${memberPath}`);
    } else {
      throw firstError;
    }
  }
}

export function repoSizeBytes(project: Project): number {
  return dirSizeBytes(projectBackupDir(project));
}

export async function restoreDatabase(
  project: Project,
  server: ServerRow,
  containerId: string,
  archive: string,
  memberPath: string,
  targetDb: string,
  overwrite: boolean,
  log: LogFn,
): Promise<void> {
  const container = await getContainer(containerId, server);
  if (container.state !== "running") {
    throw new Error(`Container ${container.name} is not running`);
  }
  const pgUser = project.pg_user;
  const exists = await execCapture(containerId, [
    "psql",
    "-U",
    pgUser,
    "-d",
    "postgres",
    "-Atc",
    `SELECT 1 FROM pg_database WHERE datname = '${targetDb.replace(/'/g, "''")}'`,
  ], {}, server);
  const targetExists = exists.stdout.trim() === "1";

  if (targetExists && !overwrite) {
    throw new Error(
      `Target database "${targetDb}" already exists. Enable overwrite to replace it.`,
    );
  }
  if (targetExists && overwrite) {
    log(`Terminating connections to ${targetDb}`);
    await execCapture(containerId, [
      "psql",
      "-U",
      pgUser,
      "-d",
      "postgres",
      "-c",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${targetDb.replace(/'/g, "''")}' AND pid <> pg_backend_pid()`,
    ], {}, server);
    log(`Dropping database ${targetDb}`);
    const drop = await execCapture(containerId, [
      "psql",
      "-U",
      pgUser,
      "-d",
      "postgres",
      "-c",
      `DROP DATABASE IF EXISTS "${targetDb.replace(/"/g, '""')}"`,
    ], {}, server);
    if (drop.exitCode !== 0) throw new Error(drop.stderr || "DROP DATABASE failed");
  }

  if (!targetExists || overwrite) {
    log(`Creating database ${targetDb}`);
    const create = await execCapture(containerId, [
      "psql",
      "-U",
      pgUser,
      "-d",
      "postgres",
      "-c",
      `CREATE DATABASE "${targetDb.replace(/"/g, '""')}"`,
    ], {}, server);
    if (create.exitCode !== 0) throw new Error(create.stderr || "CREATE DATABASE failed");
  }

  const tempFile = path.join(config.stagingRoot, `restore-${Date.now()}.dump`);
  let containerFile = "";
  try {
    await extractArchiveFile(project, archive, memberPath, tempFile, log);
    log(`Copying dump into container ${container.name}`);
    containerFile = await copyFileToContainer(containerId, tempFile, "/tmp", server);
    const plainSql = memberPath.toLowerCase().endsWith(".sql");
    if (plainSql) {
      log("Applying SQL dump with psql");
    } else {
      log(`Restoring into ${targetDb}`);
    }
    const result = plainSql
      ? await execCapture(
          containerId,
          [
            "psql",
            "-U",
            pgUser,
            "-d",
            targetDb,
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
            "-o",
            "/dev/null",
            "-f",
            containerFile,
          ],
          {},
          server,
        )
      : await execCapture(
          containerId,
          [
            "pg_restore",
            "-U",
            pgUser,
            "-d",
            targetDb,
            "--no-owner",
            "--no-privileges",
            containerFile,
          ],
          {},
          server,
        );
    for (const text of [result.stdout, result.stderr]) {
      if (!text.trim()) continue;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) log(line);
      }
    }
    if (result.exitCode !== 0) {
      throw new Error(
        `${plainSql ? "psql" : "pg_restore"} failed with exit code ${result.exitCode}`,
      );
    }
  } finally {
    if (containerFile) {
      await execCapture(containerId, ["rm", "-f", containerFile], {}, server).catch(() => {});
    }
    try {
      fs.rmSync(tempFile, { force: true });
    } catch {
      /* ignore */
    }
  }
}
