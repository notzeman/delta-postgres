import fs from "fs";
import path from "path";
import { config } from "./config";
import {
  pool,
  getJob,
  getProject,
  getSettings,
  type BackupJob,
  type Project,
} from "./db";
import {
  containerDatabases,
  postgresVersion,
  execToFile,
  PG_READ_ONLY_ENV,
} from "./docker";
import { resolveProjectContainer } from "./containerResolver";
import {
  createArchive,
  pruneArchive,
  listArchives,
  archiveInfo,
  repoSizeBytes,
  invalidateRepoSize,
} from "./borg";
import { getServer } from "./servers";
import {
  ensureDir,
  rmrf,
  hashFile,
  fileSize,
  tailFile,
} from "./utils";

const activeJobs = new Set<number>();
const activeServers = new Set<number>();
const canceledJobs = new Set<number>();
// Aborts the in-flight pg_dump stream of a running job when it is canceled.
const jobAborts = new Map<number, AbortController>();
let workerTimer: NodeJS.Timeout | null = null;
let ticking = false;

class JobCanceledError extends Error {
  constructor() {
    super("Backup canceled");
  }
}

export function jobLogFile(jobId: number): string {
  return path.join(config.logsDir, `job-${jobId}.log`);
}

export function ensureJobLog(jobId: number): string {
  ensureDir(config.logsDir);
  const file = jobLogFile(jobId);
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
  return file;
}

export function appendLog(jobId: number, line: string): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  const text = String(line).replace(/\r/g, "");
  try {
    fs.appendFileSync(jobLogFile(jobId), `[${timestamp}] ${text}\n`);
  } catch {
    /* ignore logging failures */
  }
}

export function readJobLog(jobId: number, maxLines = 600): string {
  return tailFile(jobLogFile(jobId), maxLines);
}

export async function createJob(
  projectId: number,
  trigger: string,
): Promise<BackupJob> {
  const { rows } = await pool.query<BackupJob>(
    `INSERT INTO backup_jobs(project_id, trigger, status, log_file)
     VALUES($1, $2, 'queued', $3)
     RETURNING *`,
    [projectId, trigger, jobLogFile(0)],
  );
  const job = rows[0];
  const file = ensureJobLog(job.id);
  await pool.query(`UPDATE backup_jobs SET log_file = $1 WHERE id = $2`, [
    file,
    job.id,
  ]);
  job.log_file = file;
  appendLog(job.id, `Job #${job.id} queued (${trigger})`);
  return job;
}

export async function hasActiveJob(projectId: number): Promise<boolean> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM backup_jobs
     WHERE project_id = $1 AND status IN ('queued', 'running')`,
    [projectId],
  );
  return Number(rows[0]?.count || 0) > 0;
}

export async function enqueueProject(
  projectId: number,
  trigger: string,
): Promise<BackupJob | null> {
  if (trigger === "scheduled" && (await hasActiveJob(projectId))) return null;
  return createJob(projectId, trigger);
}

export async function enqueueAll(
  trigger: string,
  serverId?: number,
): Promise<BackupJob[]> {
  const { rows } = serverId
    ? await pool.query<Project>(
        `SELECT * FROM projects WHERE enabled = true AND ignored = false AND server_id = $1 ORDER BY name`,
        [serverId],
      )
    : await pool.query<Project>(
        `SELECT * FROM projects WHERE enabled = true AND ignored = false ORDER BY name`,
      );
  const jobs: BackupJob[] = [];
  for (const project of rows) {
    if (trigger === "scheduled" && (await hasActiveJob(project.id))) continue;
    jobs.push(await createJob(project.id, trigger));
  }
  return jobs;
}

function checkCanceled(jobId: number): void {
  if (canceledJobs.has(jobId)) throw new JobCanceledError();
}

async function notifyWebhook(
  project: Project,
  jobId: number,
  status: "success" | "failed",
  error?: string,
): Promise<void> {
  try {
    const settings = await getSettings();
    const url = String(settings.notificationWebhook || "").trim();
    if (!url) return;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: `backup.${status}`,
        project: { id: project.id, name: project.name, slug: project.slug },
        job: { id: jobId, status },
        error: error || null,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });
    appendLog(jobId, `Webhook notified (${response.status})`);
  } catch (error) {
    appendLog(
      jobId,
      `Webhook notification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function executeBackup(job: BackupJob, project: Project): Promise<void> {
  const abort = new AbortController();
  jobAborts.set(job.id, abort);
  if (canceledJobs.has(job.id)) abort.abort();
  try {
    await executeBackupSteps(job, project, abort.signal);
  } finally {
    jobAborts.delete(job.id);
  }
}

async function executeBackupSteps(
  job: BackupJob,
  project: Project,
  signal: AbortSignal,
): Promise<void> {
  const log = (line: string) => appendLog(job.id, line);
  // Read-only sessions: pg_dump/pg_dumpall can never write to the source DB.
  const dumpOpts = { env: PG_READ_ONLY_ENV, signal };

  try {
    const stat: any = (fs as any).statfsSync(config.backupRoot);
    const free = Number(stat.bavail) * Number(stat.bsize);
    log(`Free backup space: ${(free / 1024 / 1024 / 1024).toFixed(1)} GB`);
    if (free < 512 * 1024 * 1024) {
      throw new Error("Less than 512 MB free on the backup volume; refusing to start backup");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Less than")) throw error;
  }

  const server = await getServer(project.server_id);
  if (!server) throw new Error("Docker server not found for this project");
  const { container, changed, previous } = await resolveProjectContainer(project, server);
  if (changed) {
    log(
      `Re-linked container: ${previous.name || previous.id || "unknown"} -> ${container.name} (${container.id.slice(0, 12)})`,
    );
  }
  if (container.state !== "running") {
    throw new Error(`Container ${container.name} is not running (state: ${container.state})`);
  }
  const pgUser = project.pg_user || container.env.POSTGRES_USER || "postgres";
  log(`Server: ${server.name} (${server.type === "local" ? "local socket" : `${server.protocol}://${server.host}:${server.port}`})`);
  log(`Container: ${container.name} (${container.image})`);
  log(`PostgreSQL user: ${pgUser}`);

  let databases: string[];
  if (project.databases && project.databases.length > 0) {
    databases = project.databases;
    log(`Using selected databases: ${databases.join(", ")}`);
  } else {
    const dbs = await containerDatabases(container.id, pgUser, server);
    const names = dbs.map((d) => d.name);
    const primary =
      project.pg_default_db ||
      container.env.POSTGRES_DB ||
      names.find((name) => name !== "postgres") ||
      names[0];
    if (primary && names.includes(primary)) {
      databases = [primary];
    } else {
      databases = names.filter((name) => name !== "postgres").slice(0, 1);
    }
    log(`Using primary database: ${databases.join(", ") || "none"}`);
  }
  if (databases.length === 0) throw new Error("No databases found to back up");

  const version = await postgresVersion(container.id, pgUser, server);
  log(`Server version: ${version || "unknown"}`);

  const staging = path.join(config.stagingRoot, `job-${job.id}`);
  rmrf(staging);
  ensureDir(path.join(staging, "databases"));

  try {
    checkCanceled(job.id);
    const globalsFile = path.join(staging, "globals.sql");
    log("Dumping roles and globals");
    const globals = await execToFile(
      container.id,
      ["pg_dumpall", "-U", pgUser, "--globals-only"],
      globalsFile,
      (line) => log(`pg_dumpall: ${line}`),
      dumpOpts,
      server,
    );
    if (globals.exitCode !== 0) {
      throw new Error(globals.stderr.trim() || "pg_dumpall failed");
    }

    const manifestDbs: Array<{
      name: string;
      file: string;
      sizeBytes: number;
      sha256: string;
    }> = [];

    for (const db of databases) {
      checkCanceled(job.id);
      const safeName = db.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const dumpFile = path.join(staging, "databases", `${safeName}.dump`);
      log(`Dumping database ${db}`);
      const started = Date.now();
      const dump = await execToFile(
        container.id,
        [
          "pg_dump",
          "-U",
          pgUser,
          "-Fc",
          "-Z",
          "0",
          // Never hold ACCESS SHARE locks behind a waiting DDL statement.
          "--lock-wait-timeout=30s",
          "-d",
          db,
        ],
        dumpFile,
        (line) => log(`pg_dump ${db}: ${line}`),
        dumpOpts,
        server,
      );
      if (dump.exitCode !== 0) {
        throw new Error(dump.stderr.trim() || `pg_dump failed for ${db}`);
      }
      const sizeBytes = fileSize(dumpFile);
      const sha256 = await hashFile(dumpFile);
      manifestDbs.push({
        name: db,
        file: `databases/${safeName}.dump`,
        sizeBytes,
        sha256,
      });
      log(
        `Dumped ${db}: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB in ${(
          (Date.now() - started) / 1000
        ).toFixed(1)}s`,
      );
    }

    checkCanceled(job.id);
    const manifest = {
      format: "delta-postgres-v1",
      appVersion: config.appVersion,
      project: { id: project.id, name: project.name, slug: project.slug },
      container: {
        id: container.id,
        name: container.name,
        image: container.image,
        postgresVersion: version,
      },
      pgUser,
      databases: manifestDbs,
      globals: {
        file: "globals.sql",
        sizeBytes: fileSize(globalsFile),
        sha256: await hashFile(globalsFile),
      },
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(staging, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const archiveName = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "T")
      .replace("Z", "Z");
    checkCanceled(job.id);
    const stats = await createArchive(project, staging, archiveName, log);

    await pool.query(
      `INSERT INTO archives(project_id, job_id, name, created_at, size_bytes,
        original_size, deduplicated_size, file_count)
       VALUES($1, $2, $3, now(), $4, $5, $6, $7)
       ON CONFLICT (project_id, name) DO UPDATE SET
         job_id = EXCLUDED.job_id,
         size_bytes = EXCLUDED.size_bytes,
         original_size = EXCLUDED.original_size,
         deduplicated_size = EXCLUDED.deduplicated_size,
         file_count = EXCLUDED.file_count`,
      [
        project.id,
        job.id,
        archiveName,
        stats.compressedSize,
        stats.originalSize,
        stats.deduplicatedSize,
        stats.fileCount,
      ],
    );
    await pool.query(
      `UPDATE backup_jobs SET archive_name = $1, size_bytes = $2 WHERE id = $3`,
      [archiveName, stats.deduplicatedSize, job.id],
    );

    await pruneArchive(project, log);
    await reconcileProjectArchives(project);
    checkCanceled(job.id);

    await pool.query(
      `UPDATE projects SET last_backup_at = now(), last_status = 'success',
         last_error = NULL, updated_at = now() WHERE id = $1`,
      [project.id],
    );
    invalidateRepoSize(project);
    log(`Backup completed. Repo size: ${((await repoSizeBytes(project)) / 1024 / 1024).toFixed(1)} MB`);
  } finally {
    rmrf(staging);
  }
}

export async function runJob(jobId: number): Promise<void> {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  canceledJobs.delete(jobId);
  try {
    const job = await getJob(jobId);
    if (!job) return;
    if (job.status !== "queued") return;
    const project = await getProject(job.project_id);
    if (!project) throw new Error("Project not found");

    await pool.query(
      `UPDATE backup_jobs SET status = 'running', started_at = now() WHERE id = $1`,
      [jobId],
    );
    await pool.query(
      `UPDATE projects SET last_status = 'running', updated_at = now() WHERE id = $1`,
      [project.id],
    );
    appendLog(jobId, `Starting backup for ${project.name}`);

    try {
      await executeBackup(job, project);
      await pool.query(
        `UPDATE backup_jobs SET status = 'success', finished_at = now() WHERE id = $1`,
        [jobId],
      );
      appendLog(jobId, "Job finished successfully");
    } catch (error) {
      const canceled = error instanceof JobCanceledError || canceledJobs.has(jobId);
      const message = canceled
        ? "Canceled by user"
        : error instanceof Error
          ? error.message
          : String(error);
      await pool.query(
        `UPDATE backup_jobs SET status = $1, finished_at = now(), error = $2 WHERE id = $3`,
        [canceled ? "canceled" : "failed", message, jobId],
      );
      await pool.query(
        `UPDATE projects SET last_status = $1, last_error = $2, updated_at = now() WHERE id = $3`,
        [canceled ? "canceled" : "failed", message, project.id],
      );
      appendLog(jobId, `ERROR: ${message}`);
    }
  } catch (error) {
    appendLog(jobId, `Worker error: ${error instanceof Error ? error.message : String(error)}`);
    await pool
      .query(
        `UPDATE backup_jobs SET status = 'failed', finished_at = now(), error = $1 WHERE id = $2`,
        [error instanceof Error ? error.message : String(error), jobId],
      )
      .catch(() => {});
  } finally {
    activeJobs.delete(jobId);
    canceledJobs.delete(jobId);
  }
}

export function cancelJob(jobId: number): void {
  canceledJobs.add(jobId);
  // Stop a dump that is already streaming instead of letting it run to the end.
  jobAborts.get(jobId)?.abort();
  appendLog(jobId, "Cancel requested by user");
  pool
    .query(
      `UPDATE backup_jobs SET status = 'canceled', finished_at = now(), error = 'Canceled by user'
       WHERE id = $1 AND status = 'queued'`,
      [jobId],
    )
    .catch(() => {});
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const settings = await getSettings();
    const concurrency = Math.max(
      1,
      Number(settings.concurrency || config.concurrency),
    );
    while (activeJobs.size < concurrency) {
      // Serialize backups per Docker server. Even if concurrency is raised,
      // a single source host never gets more than one concurrent dump.
      const busyServers = Array.from(activeServers);
      const { rows } = await pool.query<{ id: number; server_id: number }>(
        `UPDATE backup_jobs SET status = 'running', started_at = now()
         WHERE id = (
           SELECT bj.id FROM backup_jobs bj
           JOIN projects p ON p.id = bj.project_id
           WHERE bj.status = 'queued'
             AND NOT (p.server_id = ANY($1::int[]))
           ORDER BY bj.created_at ASC
           LIMIT 1
           FOR UPDATE OF bj SKIP LOCKED
         )
         RETURNING id,
           (SELECT server_id FROM projects WHERE id = backup_jobs.project_id) AS server_id`,
        [busyServers],
      );
      if (!rows[0]) break;
      const jobId = rows[0].id;
      // runJob expects queued, but we just claimed it; run with a flag.
      activeServers.add(rows[0].server_id);
      activeJobs.add(jobId);
      void runClaimedJob(jobId, rows[0].server_id);
    }
  } catch (error) {
    console.error("Job worker error", error);
  } finally {
    ticking = false;
  }
}

async function runClaimedJob(jobId: number, serverId: number): Promise<void> {
  let project: Project | null = null;
  try {
    const job = await getJob(jobId);
    if (!job) return;
    project = await getProject(job.project_id);
    if (!project) throw new Error("Project not found");
    appendLog(jobId, `Starting backup for ${project.name} (${job.trigger})`);
    await executeBackup(job, project);
    await pool.query(
      `UPDATE backup_jobs SET status = 'success', finished_at = now() WHERE id = $1`,
      [jobId],
    );
    appendLog(jobId, "Job finished successfully");
    await notifyWebhook(project, jobId, "success");
  } catch (error) {
    const canceled = error instanceof JobCanceledError || canceledJobs.has(jobId);
    const message = canceled
      ? "Canceled by user"
      : error instanceof Error
        ? error.message
        : String(error);
    await pool.query(
      `UPDATE backup_jobs SET status = $1, finished_at = now(), error = $2 WHERE id = $3`,
      [canceled ? "canceled" : "failed", message, jobId],
    );
    if (project) {
      await pool
        .query(
          `UPDATE projects SET last_status = $1, last_error = $2, updated_at = now() WHERE id = $3`,
          [canceled ? "canceled" : "failed", message, project.id],
        )
        .catch(() => {});
    }
    appendLog(jobId, `ERROR: ${message}`);
    if (!canceled && project) await notifyWebhook(project, jobId, "failed", message);
  } finally {
    activeJobs.delete(jobId);
    activeServers.delete(serverId);
    canceledJobs.delete(jobId);
  }
}

export function startJobWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void tick();
  }, 2000);
  void tick();
}

export function stopJobWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}

export async function syncProjectArchives(project: Project): Promise<void> {
  const archives = await listArchives(project);
  const names: string[] = [];
  for (const archive of archives) {
    names.push(archive.name);
    let stats = {
      originalSize: 0,
      compressedSize: 0,
      deduplicatedSize: 0,
      fileCount: 0,
    };
    try {
      const info = await archiveInfo(project, archive.name);
      stats = {
        originalSize: info.originalSize,
        compressedSize: info.compressedSize,
        deduplicatedSize: info.deduplicatedSize,
        fileCount: info.fileCount,
      };
    } catch {
      /* keep zeros if info fails */
    }
    await pool.query(
      `INSERT INTO archives(project_id, name, created_at, size_bytes,
         original_size, deduplicated_size, file_count)
       VALUES($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, name) DO UPDATE SET
         created_at = COALESCE(archives.created_at, EXCLUDED.created_at),
         size_bytes = CASE WHEN archives.job_id IS NOT NULL THEN archives.size_bytes ELSE EXCLUDED.size_bytes END,
         original_size = CASE WHEN archives.job_id IS NOT NULL THEN archives.original_size ELSE EXCLUDED.original_size END,
         deduplicated_size = CASE WHEN archives.job_id IS NOT NULL THEN archives.deduplicated_size ELSE EXCLUDED.deduplicated_size END,
         file_count = CASE WHEN archives.job_id IS NOT NULL THEN archives.file_count ELSE EXCLUDED.file_count END`,
      [
        project.id,
        archive.name,
        archive.start ? new Date(archive.start) : null,
        stats.compressedSize,
        stats.originalSize,
        stats.deduplicatedSize,
        stats.fileCount,
      ],
    );
  }
  await removeMissingArchiveRows(project.id, names);
}

async function removeMissingArchiveRows(projectId: number, names: string[]): Promise<void> {
  await pool.query(
    `DELETE FROM archives
     WHERE project_id = $1 AND NOT (name = ANY($2::text[]))`,
    [projectId, names],
  );
}

/**
 * Cheap reconciliation used after prune/delete operations: list Borg archives
 * and drop catalog rows that no longer exist in the repository.
 */
export async function reconcileProjectArchives(project: Project): Promise<void> {
  const archives = await listArchives(project);
  await removeMissingArchiveRows(
    project.id,
    archives.map((archive) => archive.name),
  );
}

export function runningJobCount(): number {
  return activeJobs.size;
}
