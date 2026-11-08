import { parseExpression } from "cron-parser";
import { config } from "./config";
import { pool, getSettings, type Project } from "./db";
import { enqueueProject, hasActiveJob } from "./jobs";

let timer: NodeJS.Timeout | null = null;

export function computeNextRun(cron: string, from = new Date()): Date | null {
  try {
    const interval = parseExpression(cron, {
      currentDate: from,
      tz: config.timezone,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
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
  const cron = project.schedule_cron || (await globalCron());
  const next = computeNextRun(cron);
  await pool.query(`UPDATE projects SET next_run_at = $1 WHERE id = $2`, [
    next,
    projectId,
  ]);
}

export async function recomputeAllSchedules(): Promise<void> {
  const cron = await globalCron();
  const { rows } = await pool.query<Project>(`SELECT * FROM projects`);
  for (const project of rows) {
    if (project.schedule_cron) continue;
    const next = computeNextRun(cron);
    await pool.query(`UPDATE projects SET next_run_at = $1 WHERE id = $2`, [
      next,
      project.id,
    ]);
  }
}

async function tick(): Promise<void> {
  const cron = await globalCron();
  const { rows } = await pool.query<Project>(
    `SELECT * FROM projects WHERE enabled = true`,
  );
  const now = new Date();
  for (const project of rows) {
    const projectCron = project.schedule_cron || cron;
    const next = project.next_run_at ? new Date(project.next_run_at) : null;

    if (!next) {
      const computed = computeNextRun(projectCron);
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
      const computed = computeNextRun(projectCron, now);
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
