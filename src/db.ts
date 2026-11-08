import { Pool } from "pg";
import { config } from "./config";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

export interface Project {
  id: number;
  name: string;
  slug: string;
  source: string;
  enabled: boolean;
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

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'auto',
      enabled BOOLEAN NOT NULL DEFAULT true,
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

  // Mark interrupted jobs from a previous process.
  await pool.query(
    `UPDATE backup_jobs
     SET status = 'failed',
         error = COALESCE(error, 'Interrupted by dashboard restart'),
         finished_at = now()
     WHERE status = 'running'`,
  );
}

export async function getProjects(): Promise<Project[]> {
  const { rows } = await pool.query<Project>(`SELECT * FROM projects ORDER BY name ASC`);
  return rows;
}

export async function getProject(id: number): Promise<Project | null> {
  const { rows } = await pool.query<Project>(`SELECT * FROM projects WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const { rows } = await pool.query<Project>(`SELECT * FROM projects WHERE slug = $1`, [slug]);
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

export async function getIgnoredProjects(): Promise<string[]> {
  const { rows } = await pool.query<{ compose_project: string }>(
    `SELECT compose_project FROM ignored_projects`,
  );
  return rows.map((r) => r.compose_project);
}
