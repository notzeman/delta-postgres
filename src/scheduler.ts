import { parseExpression } from "cron-parser";
import { config } from "./config";
import { pool, getSettings, type Project } from "./db";
import { enqueueProject, hasActiveJob } from "./jobs";

let timer: NodeJS.Timeout | null = null;

export function computeNextRun(
  cron: string,
  from = new Date(),
  timezone = config.timezone,
): Date | null {
  try {
    const interval = parseExpression(cron, {
      currentDate: from,
      tz: timezone,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

export async function currentTimezone(): Promise<string> {
  const settings = await getSettings();
  return String(settings.timezone || config.timezone);
}

export async function globalCron(): Promise<string> {
  const settings = await getSettings();
  return String(settings.globalCron || config.defaultCron);
}

export async function recomputeProjectSchedule(projectId: number): Promise<void> {
  const { rows } = await pool.query<Project>(`SELECT * FROM projects WHERE id = $1`, [
    projectId,
  ]);
  const project = rows[0];
  if (!project) return;
  const settings = await getSettings();
  const cron = project.schedule_cron || String(settings.globalCron || config.defaultCron);
  const timezone = String(settings.timezone || config.timezone);
  const next = computeNextRun(cron, new Date(), timezone);
  await pool.query(`UPDATE projects SET next_run_at = $1 WHERE id = $2`, [
    next,
    projectId,
  ]);
}

export async function recomputeAllSchedules(includeOverrides = false): Promise<void> {
  const settings = await getSettings();
  const cron = String(settings.globalCron || config.defaultCron);
  const timezone = String(settings.timezone || config.timezone);
  const { rows } = await pool.query<Project>(`SELECT * FROM projects`);
  for (const project of rows) {
    if (!includeOverrides && project.schedule_cron) continue;
    const projectCron = project.schedule_cron || cron;
    const next = computeNextRun(projectCron, new Date(), timezone);
    await pool.query(`UPDATE projects SET next_run_at = $1 WHERE id = $2`, [
      next,
      project.id,
    ]);
  }
}

async function tick(): Promise<void> {
  const settings = await getSettings();
  const cron = String(settings.globalCron || config.defaultCron);
  const timezone = String(settings.timezone || config.timezone);
  const { rows } = await pool.query<Project>(
    `SELECT * FROM projects WHERE enabled = true AND ignored = false`,
  );
  const now = new Date();
  for (const project of rows) {
    const projectCron = project.schedule_cron || cron;
    const next = project.next_run_at ? new Date(project.next_run_at) : null;

    if (!next) {
      const computed = computeNextRun(projectCron, now, timezone);
      await pool.query(`UPDATE projects SET next_run_at = $1 WHERE id = $2`, [
        computed,
        project.id,
      ]);
      continue;
    }

    if (next <= now) {
      if (!(await hasActiveJob(project.id))) {
        const job = await enqueueProject(project.id, "scheduled");
        if (job) console.log(`Enqueued scheduled backup for ${project.name} (job ${job.id})`);
      }
      const computed = computeNextRun(projectCron, now, timezone);
      await pool.query(`UPDATE projects SET next_run_at = $1 WHERE id = $2`, [
        computed,
        project.id,
      ]);
    }
  }
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((error) => console.error("Scheduler error", error));
  }, 30_000);
  tick().catch((error) => console.error("Scheduler error", error));
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
