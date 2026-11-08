import { computeNextRun, globalCron } from "./scheduler";
import {
  audit,
  getIgnoredProjects,
  getProjects,
  getSettings,
  pool,
} from "./db";
import { discoverProjects, type DiscoveredProject } from "./discovery";
import { listServers } from "./servers";
import { slugify } from "./utils";

/**
 * Add every detected PostgreSQL compose project to the managed project list.
 * Existing container/compose mappings and explicitly ignored projects are skipped.
 * Projects are scoped to their Docker server.
 */
export async function autoImportDiscoveredProjects(
  discovered: DiscoveredProject[],
): Promise<number> {
  const settings = await getSettings();
  if (settings.autoAddProjects === false) return 0;

  const [projects, cron] = await Promise.all([getProjects(), globalCron()]);
  const managedContainers = new Map<number, Set<string>>();
  const managedCompose = new Map<number, Set<string>>();
  const managedSlugs = new Map<number, Set<string>>();
  const ignoredCache = new Map<number, Set<string>>();

  const setFor = (map: Map<number, Set<string>>, key: number) => {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    return set;
  };

  for (const project of projects) {
    if (project.container_id) setFor(managedContainers, project.server_id).add(project.container_id);
    if (project.container_name) setFor(managedContainers, project.server_id).add(project.container_name);
    if (project.compose_project) setFor(managedCompose, project.server_id).add(project.compose_project);
    setFor(managedSlugs, project.server_id).add(project.slug);
  }

  const ignoredFor = async (serverId: number): Promise<Set<string>> => {
    let set = ignoredCache.get(serverId);
    if (!set) {
      set = new Set(await getIgnoredProjects(serverId));
      ignoredCache.set(serverId, set);
    }
    return set;
  };

  const nextRun = computeNextRun(cron);
  let added = 0;

  for (const item of discovered) {
    if (item.ignored || item.managedProjectId) continue;
    const serverId = item.serverId;
    const ignoredSet = await ignoredFor(serverId);
    if (item.composeProject && (ignoredSet.has(item.composeProject) || setFor(managedCompose, serverId).has(item.composeProject))) {
      continue;
    }
    if (ignoredSet.has(item.key)) continue;
    const primary = item.containers.find((container) => container.state === "running") ||
      item.containers[0];
    if (!primary) continue;
    if (
      setFor(managedContainers, serverId).has(primary.id) ||
      setFor(managedContainers, serverId).has(primary.name) ||
      ignoredSet.has(primary.name)
    ) {
      continue;
    }

    const baseSlug = slugify(item.name);
    let slug = baseSlug;
    let suffix = 1;
    while (setFor(managedSlugs, serverId).has(slug)) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const enabled = item.containers.some((container) => container.state === "running");
    await pool.query(
      `INSERT INTO projects(name, slug, source, enabled, server_id, container_id,
         container_name, container_image, compose_project, pg_user, pg_default_db,
         databases, schedule_cron, notes, next_run_at)
       VALUES($1, $2, 'auto', $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL, $11, $12)`,
      [
        item.name,
        slug,
        enabled,
        serverId,
        primary.id,
        primary.name,
        primary.image,
        item.composeProject,
        primary.pgUser,
        primary.pgDefaultDb,
        "Auto-discovered from Docker Compose. Edit settings to customize.",
        nextRun,
      ],
    );
    await audit("system", "discovery.auto_add", slug, {
      container: primary.name,
      composeProject: item.composeProject,
      server: item.serverName,
    });

    setFor(managedSlugs, serverId).add(slug);
    setFor(managedContainers, serverId).add(primary.id);
    setFor(managedContainers, serverId).add(primary.name);
    if (item.composeProject) setFor(managedCompose, serverId).add(item.composeProject);
    added += 1;
  }

  return added;
}

export async function runAutoDiscovery(): Promise<number> {
  const servers = await listServers();
  let added = 0;
  for (const server of servers) {
    if (!server.enabled) continue;
    try {
      const discovered = await discoverProjects(server);
      added += await autoImportDiscoveredProjects(discovered);
    } catch (error) {
      console.error(`Auto-discovery failed for ${server.name}`, error);
    }
  }
  return added;
}
