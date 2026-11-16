import { config } from "./config";
import { getSettings, pool, type Project } from "./db";
import { isPostgresImage, listAllContainers, type ContainerInfo } from "./docker";
import { computeNextRun } from "./scheduler";
import { getLocalServer } from "./servers";

const DEFAULT_SLUG = "dashboard-database";
const DEFAULT_NAME = "Dashboard database";

function parseDatabaseUrl(raw: string): {
  host: string;
  user: string;
  database: string;
} {
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      user: decodeURIComponent(url.username || ""),
      database: decodeURIComponent(url.pathname.replace(/^\//, "") || ""),
    };
  } catch {
    return { host: "", user: "", database: "" };
  }
}

function findDashboardDbContainer(
  containers: ContainerInfo[],
  dbHost: string,
): ContainerInfo | null {
  return (
    containers.find(
      (container) =>
        isPostgresImage(container.image) &&
        (container.composeService === "dashboard-db" ||
          container.name === "delta-postgres-db" ||
          (dbHost !== "" && container.name === dbHost)),
    ) || null
  );
}

/**
 * Ensure the dashboard's own metadata database is present as a managed project.
 * It uses the same container/backup pipeline as every other PostgreSQL project.
 * User-managed settings (schedule, retention, retries, notes) are preserved.
 */
export async function ensureDefaultProject(): Promise<Project | null> {
  let server;
  try {
    server = await getLocalServer();
  } catch {
    return null;
  }

  const containers = await listAllContainers(server).catch(() => []);
  const db = parseDatabaseUrl(config.databaseUrl);
  const container = findDashboardDbContainer(containers, db.host);
  if (!container) return null;

  const existing = await pool.query<Project>(
    `SELECT * FROM projects WHERE is_default = true LIMIT 1`,
  );
  const current = existing.rows[0];
  if (current) {
    if (
      current.container_id !== container.id ||
      current.container_name !== container.name ||
      current.container_image !== container.image ||
      current.compose_project !== container.composeProject
    ) {
      await pool.query(
        `UPDATE projects
         SET container_id = $1, container_name = $2, container_image = $3,
             compose_project = $4, updated_at = now()
         WHERE id = $5`,
        [
          container.id,
          container.name,
          container.image,
          container.composeProject,
          current.id,
        ],
      );
      current.container_id = container.id;
      current.container_name = container.name;
      current.container_image = container.image;
      current.compose_project = container.composeProject;
    }
    return current;
  }

  const settings = await getSettings();
  const cron = String(settings.globalCron || config.defaultCron);
  const timezone = String(settings.timezone || config.timezone);
  const nextRun = computeNextRun(cron, new Date(), timezone);
  const pgUser = db.user || container.env.POSTGRES_USER || "dashboard";
  const pgDefaultDb =
    db.database || container.env.POSTGRES_DB || "backup_dashboard";

  const { rows } = await pool.query<Project>(
    `INSERT INTO projects(name, slug, source, enabled, server_id, container_id,
       container_name, container_image, compose_project, pg_user, pg_default_db,
       databases, schedule_cron, notes, next_run_at, is_default)
     VALUES($1, $2, 'default', true, $3, $4, $5, $6, $7, $8, $9, $10,
            NULL, $11, $12, true)
     ON CONFLICT (server_id, slug) DO NOTHING
     RETURNING *`,
    [
      DEFAULT_NAME,
      DEFAULT_SLUG,
      server.id,
      container.id,
      container.name,
      container.image,
      container.composeProject,
      pgUser,
      pgDefaultDb,
      JSON.stringify([pgDefaultDb]),
      "Built-in project for the dashboard's own metadata database.",
      nextRun,
    ],
  );
  return rows[0] || null;
}
