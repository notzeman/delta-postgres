import path from "path";
import fs from "fs";
import crypto from "crypto";

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
const backupRoot = process.env.BACKUP_ROOT || path.resolve(process.cwd(), "backups");

function ensureSecretFile(file: string, bytes = 32): string {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const value = crypto.randomBytes(bytes).toString("base64url");
    fs.writeFileSync(file, value + "\n", { mode: 0o600 });
    return value;
  }
}

const sessionSecret =
  process.env.SESSION_SECRET ||
  ensureSecretFile(path.join(dataDir, "secrets", "session.secret"));

export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || "0.0.0.0",
  dataDir,
  backupRoot,
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://dashboard:dashboard@localhost:5432/backup_dashboard",
  sessionSecret,
  secretsKey: process.env.SECRETS_KEY || sessionSecret,
  borgPassphrase:
    process.env.BORG_PASSPHRASE ||
    ensureSecretFile(path.join(dataDir, "secrets", "borg.passphrase")),
  cookieSecure: String(process.env.COOKIE_SECURE || "false") === "true",
  timezone: process.env.TZ || "Asia/Kolkata",
  defaultCron: process.env.DEFAULT_CRON || "0 2 * * *",
  keepDaily: Number(process.env.RETENTION_KEEP_DAILY || 7),
  keepWeekly: Number(process.env.RETENTION_KEEP_WEEKLY || 4),
  keepMonthly: Number(process.env.RETENTION_KEEP_MONTHLY || 6),
  concurrency: Math.max(1, Number(process.env.CONCURRENCY || 1)),
  stagingRoot: path.join(dataDir, "staging"),
  logsDir: path.join(dataDir, "logs"),
  exportsDir: path.join(dataDir, "exports"),
  dockerSocket: process.env.DOCKER_SOCKET || "/var/run/docker.sock",
  appVersion: "1.0.0",
};

export function ensureRuntimeDirs(): void {
  for (const dir of [
    config.dataDir,
    config.backupRoot,
    config.stagingRoot,
    config.logsDir,
    config.exportsDir,
    path.join(config.dataDir, "secrets"),
    path.join(config.dataDir, "borg"),
    path.join(config.dataDir, "borg", "cache"),
    path.join(config.dataDir, "borg", "config"),
    path.join(config.dataDir, "borg", "keys"),
    path.join(config.dataDir, "borg", "security"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  try {
    fs.chmodSync(path.join(config.dataDir, "secrets"), 0o700);
  } catch {
    /* ignore */
  }
}
