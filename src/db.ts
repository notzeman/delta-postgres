import { Pool } from "pg";
import { config } from "./config";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

export interface Project {
  id: number;
  server_id: number;
  server_name?: string;
  server_slug?: string;
  server_type?: string;
  server_host?: string | null;
  server_port?: number | null;
  name: string;
  slug: string;
  source: string;
  enabled: boolean;
  ignored: boolean;
  container_id: string | null;
  container_name: string | null;
  container_image: string | null;
  compose_project: string | null;
  pg_user: string;
  pg_default_db: string | null;
  databases: string[] | null;
  schedule_cron: string | null;
  keep_daily: number | null;
  keep_weekly: number | null;
  keep_monthly: number | null;
  max_retries: number;
  retry_delay_minutes: number;
  compression: string;
  notes: string | null;
  last_backup_at: string | null;
  last_status: string | null;
  last_error: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BackupJob {
  id: number;
  project_id: number;
  trigger: string;
  status: string;
  attempt: number;
  available_at: string;
  archive_name: string | null;
  started_at: string | null;
  finished_at: string | null;
  size_bytes: number | null;
  error: string | null;
  log_file: string | null;
  created_at: string;
  project_name?: string;
  project_slug?: string;
}

export interface Archive {
  id: number;
  project_id: number;
  job_id: number | null;
  name: string;
  created_at: string | null;
  size_bytes: number | null;
  original_size: number | null;
  deduplicated_size: number | null;
  file_count: number | null;
  verified_at: string | null;
}

export interface User {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface ServerRow {
  id: number;
  name: string;
  slug: string;
  type: "local" | "tcp" | "ssh";
  protocol: "socket" | "http" | "https" | "ssh";
  host: string | null;
  port: number | null;
  socket_path: string | null;
  ssh_username: string | null;
  ssh_password: string | null;
  tls_ca: string | null;
  tls_cert: string | null;
  tls_key: string | null;
  tls_verify: boolean;
  enabled: boolean;
  ssh_host_key: string | null;
  created_at: string;
  updated_at: string;
}

export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS servers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'local',
      protocol TEXT NOT NULL DEFAULT 'socket',
      host TEXT,
      port INTEGER,
      socket_path TEXT,
      ssh_username TEXT,
      ssh_password TEXT,
      tls_ca TEXT,
      tls_cert TEXT,
      tls_key TEXT,
      tls_verify BOOLEAN NOT NULL DEFAULT true,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'auto',
      enabled BOOLEAN NOT NULL DEFAULT true,
      ignored BOOLEAN NOT NULL DEFAULT false,
      container_id TEXT,
      container_name TEXT,
      container_image TEXT,
      compose_project TEXT,
      pg_user TEXT NOT NULL DEFAULT 'postgres',
      pg_default_db TEXT,
      databases JSONB,
      schedule_cron TEXT,
      keep_daily INTEGER,
      keep_weekly INTEGER,
      keep_monthly INTEGER,
      max_retries INTEGER NOT NULL DEFAULT 0,
      retry_delay_minutes INTEGER NOT NULL DEFAULT 5,
      compression TEXT NOT NULL DEFAULT 'auto,zstd,3',
      notes TEXT,
      last_backup_at TIMESTAMPTZ,
      last_status TEXT,
      last_error TEXT,
      next_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS backup_jobs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      trigger TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'queued',
      attempt INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archive_name TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      size_bytes BIGINT,
      error TEXT,
      log_file TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS archives (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      job_id INTEGER,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ,
      size_bytes BIGINT,
      original_size BIGINT,
      deduplicated_size BIGINT,
      file_count INTEGER,
      verified_at TIMESTAMPTZ,
      UNIQUE(project_id, name)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      actor TEXT,
      action TEXT NOT NULL,
      target TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ignored_projects (
      compose_project TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_project_created ON backup_jobs(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON backup_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_archives_project ON archives(project_id, created_at DESC);
  `);

  // Multi-server migration: create the local Docker host and scope existing
  // projects and ignore decisions to it.
  await pool.query(
    `INSERT INTO servers(name, slug, type, protocol, socket_path, enabled)
     VALUES('Local Docker', 'local', 'local', 'socket', $1, true)
     ON CONFLICT (slug) DO NOTHING`,
    [config.dockerSocket],
  );
  const local = await pool.query<{ id: number }>(
    `SELECT id FROM servers WHERE slug = 'local' LIMIT 1`,
  );
  const localId = local.rows[0]?.id;
  if (!localId) throw new Error("Unable to initialize the local Docker server");

  await pool.query(
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE`,
  );
  await pool.query(
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT false`,
  );
  await pool.query(
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 0`,
  );
  await pool.query(
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS retry_delay_minutes INTEGER NOT NULL DEFAULT 5`,
  );
  await pool.query(
    `ALTER TABLE backup_jobs ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0`,
  );
  await pool.query(
    `ALTER TABLE backup_jobs ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  );
  await pool.query(
    `ALTER TABLE servers ADD COLUMN IF NOT EXISTS ssh_username TEXT`,
  );
  await pool.query(
    `ALTER TABLE servers ADD COLUMN IF NOT EXISTS ssh_password TEXT`,
  );
  // The short-lived "production" flag was removed; drop its column if present.
  await pool.query(`ALTER TABLE servers DROP COLUMN IF EXISTS production`);
  // Pinned SSH host key ("<type> SHA256:<hash>"), trusted on first use.
  await pool.query(
    `ALTER TABLE servers ADD COLUMN IF NOT EXISTS ssh_host_key TEXT`,
  );
  await pool.query(`UPDATE projects SET server_id = $1 WHERE server_id IS NULL`, [
    localId,
  ]);
  await pool.query(`ALTER TABLE projects ALTER COLUMN server_id SET NOT NULL`).catch(
    () => {},
  );
  await pool.query(`ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_slug_key`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_server_slug ON projects(server_id, slug)`,
  );

  await pool.query(
    `ALTER TABLE ignored_projects ADD COLUMN IF NOT EXISTS server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE`,
  );
  await pool.query(
    `UPDATE ignored_projects SET server_id = $1 WHERE server_id IS NULL`,
    [localId],
  );
  await pool.query(
    `ALTER TABLE ignored_projects ALTER COLUMN server_id SET NOT NULL`,
  ).catch(() => {});
  const pk = await pool.query<{ conkey: number[] }>(
    `SELECT conkey FROM pg_constraint
     WHERE conrelid = 'ignored_projects'::regclass AND contype = 'p'`,
  );
  const keyCount = Array.isArray(pk.rows[0]?.conkey) ? pk.rows[0].conkey.length : 0;
  if (keyCount !== 2) {
    await pool.query(
      `ALTER TABLE ignored_projects DROP CONSTRAINT IF EXISTS ignored_projects_pkey`,
    );
    await pool.query(
      `ALTER TABLE ignored_projects ADD PRIMARY KEY (server_id, compose_project)`,
    );
  }
}

export async function initDb(): Promise<void> {
  await ensureSchema();

  // Mark interrupted jobs from a previous process.
  await pool.query(
    `UPDATE backup_jobs
     SET status = 'failed',
         error = COALESCE(error, 'Interrupted by dashboard restart'),
         finished_at = now()
     WHERE status = 'running'`,
  );
}

export async function getProjects(
  serverId?: number,
  includeIgnored = false,
): Promise<Project[]> {
  const params: any[] = [];
  const conditions: string[] = [];
  if (serverId) {
    params.push(serverId);
    conditions.push(`p.server_id = $${params.length}`);
  }
  if (!includeIgnored) conditions.push(`p.ignored = false`);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query<Project>(
    `SELECT p.*, s.name AS server_name, s.slug AS server_slug, s.type AS server_type,
            s.host AS server_host, s.port AS server_port
     FROM projects p JOIN servers s ON s.id = p.server_id
     ${where}
     ORDER BY s.name ASC, p.name ASC`,
    params,
  );
  return rows;
}

export async function getAllProjects(serverId?: number): Promise<Project[]> {
  return getProjects(serverId, true);
}

export async function getProject(id: number): Promise<Project | null> {
  const { rows } = await pool.query<Project>(
    `SELECT p.*, s.name AS server_name, s.slug AS server_slug, s.type AS server_type,
            s.host AS server_host, s.port AS server_port
     FROM projects p JOIN servers s ON s.id = p.server_id
     WHERE p.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function getProjectBySlug(
  slug: string,
  serverId: number,
): Promise<Project | null> {
  const { rows } = await pool.query<Project>(
    `SELECT p.*, s.name AS server_name, s.slug AS server_slug, s.type AS server_type,
            s.host AS server_host, s.port AS server_port
     FROM projects p JOIN servers s ON s.id = p.server_id
     WHERE p.slug = $1 AND p.server_id = $2`,
    [slug, serverId],
  );
  return rows[0] || null;
}

export async function getJob(id: number): Promise<BackupJob | null> {
  const { rows } = await pool.query<BackupJob>(
    `SELECT j.*, p.name AS project_name, p.slug AS project_slug
     FROM backup_jobs j JOIN projects p ON p.id = j.project_id
     WHERE j.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function getJobs(limit = 100): Promise<BackupJob[]> {
  const { rows } = await pool.query<BackupJob>(
    `SELECT j.*, p.name AS project_name, p.slug AS project_slug
     FROM backup_jobs j JOIN projects p ON p.id = j.project_id
     ORDER BY j.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function getArchives(projectId: number): Promise<Archive[]> {
  const { rows } = await pool.query<Archive>(
    `SELECT * FROM archives WHERE project_id = $1 ORDER BY created_at DESC NULLS LAST, name DESC`,
    [projectId],
  );
  return rows;
}

export async function getSettings(): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<{ key: string; value: unknown }>(`SELECT key, value FROM settings`);
  const map: Record<string, unknown> = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO settings(key, value) VALUES($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

export async function audit(
  actor: string,
  action: string,
  target?: string,
  meta?: unknown,
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log(actor, action, target, meta) VALUES($1, $2, $3, $4::jsonb)`,
    [actor, action, target || null, meta ? JSON.stringify(meta) : null],
  );
}

export async function getIgnoredProjects(serverId: number): Promise<string[]> {
  const { rows } = await pool.query<{ compose_project: string }>(
    `SELECT compose_project FROM ignored_projects WHERE server_id = $1`,
    [serverId],
  );
  return rows.map((r) => r.compose_project);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const { rows } = await pool.query<User>(
    `SELECT * FROM users WHERE lower(username) = lower($1)`,
    [username],
  );
  return rows[0] || null;
}

export async function countUsers(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM users`,
  );
  return Number(rows[0]?.count || 0);
}

export async function saveUser(username: string, passwordHash: string): Promise<User> {
  const { rows } = await pool.query<User>(
    `INSERT INTO users(username, password_hash)
     VALUES($1, $2)
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       updated_at = now()
     RETURNING *`,
    [username, passwordHash],
  );
  return rows[0];
}
