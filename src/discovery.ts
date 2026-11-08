import {
  listAllContainers,
  isPostgresImage,
  containerDatabases,
  postgresVersion,
  type ContainerInfo,
} from "./docker";
import {
  getProjects,
  getIgnoredProjects,
  type Project,
  type ServerRow,
} from "./db";

export interface DiscoveredContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  composeProject: string | null;
  composeService: string | null;
  workingDir: string | null;
  pgUser: string;
  pgDefaultDb: string | null;
  databases: Array<{ name: string; sizeBytes: number }>;
  pgVersion: string;
  error?: string;
}

export interface DiscoveredProject {
  key: string;
  name: string;
  serverId: number;
  serverName: string;
  serverSlug: string;
  composeProject: string | null;
  workingDir: string | null;
  status: "running" | "partial" | "stopped" | "error";
  containers: DiscoveredContainer[];
  databases: string[];
  sizeBytes: number;
  pgVersion: string;
  managedProjectId: number | null;
  ignored: boolean;
  error?: string;
}

export interface ComposeProjectSummary {
  name: string;
  serverId: number;
  serverName: string;
  containerCount: number;
  running: number;
  hasPostgres: boolean;
}

const DISCOVERY_IGNORE_LABEL = "backup.ignore";
const DISCOVERY_ENABLE_LABEL = "backup.enable";

function deriveKey(name: string): string {
  return name
    .replace(/^\//, "")
    .replace(/[-_](postgres|postgresql|pg|db|database|timescale|timescaledb)[-_]?\d*$/i, "")
    .replace(/[-_]\d+$/, "");
}

function pgUserFor(container: ContainerInfo): string {
  return container.env.POSTGRES_USER || container.env.PGUSER || "postgres";
}

function pgDefaultDbFor(container: ContainerInfo, user: string): string | null {
  return container.env.POSTGRES_DB || container.env.PGDATABASE || user;
}

export async function discoverProjects(server: ServerRow): Promise<DiscoveredProject[]> {
  const [containers, projects, ignored] = await Promise.all([
    listAllContainers(server),
    getProjects(),
    getIgnoredProjects(server.id),
  ]);

  const ignoredSet = new Set(ignored);
  const managedByContainer = new Map<string, Project>();
  const managedByCompose = new Map<string, Project>();
  for (const project of projects) {
    if (project.server_id !== server.id) continue;
    if (project.container_id) managedByContainer.set(project.container_id, project);
    if (project.container_name) managedByContainer.set(project.container_name, project);
    if (project.compose_project) managedByCompose.set(project.compose_project, project);
  }

  const postgresContainers = containers.filter(
    (c) =>
      isPostgresImage(c.image) &&
      c.labels[DISCOVERY_IGNORE_LABEL] !== "true" &&
      c.labels[DISCOVERY_ENABLE_LABEL] !== "false",
  );

  const groups = new Map<string, ContainerInfo[]>();
  for (const container of postgresContainers) {
    const key = container.composeProject || deriveKey(container.name);
    const list = groups.get(key) || [];
    list.push(container);
    groups.set(key, list);
  }

  const discovered: DiscoveredProject[] = [];

  for (const [key, groupContainers] of groups) {
    const primary = groupContainers.find((c) => c.state === "running") || groupContainers[0];
    const composeProject = primary.composeProject || null;
    const managed =
      managedByContainer.get(primary.id) ||
      managedByContainer.get(primary.name) ||
      (composeProject ? managedByCompose.get(composeProject) : undefined) ||
      null;

    const details: DiscoveredContainer[] = [];
    let allDbs = new Set<string>();
    let totalSize = 0;
    let version = "";
    let groupError = "";

    for (const container of groupContainers) {
      const user = pgUserFor(container);
      const detail: DiscoveredContainer = {
        id: container.id,
        name: container.name,
        image: container.image,
        state: container.state,
        composeProject: container.composeProject,
        composeService: container.composeService,
        workingDir: container.workingDir,
        pgUser: user,
        pgDefaultDb: pgDefaultDbFor(container, user),
        databases: [],
        pgVersion: "",
      };
      if (container.state === "running") {
        try {
          detail.databases = await containerDatabases(container.id, user, server);
          detail.pgVersion = await postgresVersion(container.id, user, server);
          version = detail.pgVersion || version;
          for (const db of detail.databases) {
            allDbs.add(db.name);
            totalSize += db.sizeBytes;
          }
        } catch (error) {
          detail.error = error instanceof Error ? error.message : String(error);
          groupError = detail.error;
        }
      }
      details.push(detail);
    }

    // Do not auto-detect compose projects that only have an explicitly ignored label.
    const ignoredFlag =
      ignoredSet.has(key) ||
      (!!composeProject && ignoredSet.has(composeProject)) ||
      groupContainers.some((c) => ignoredSet.has(c.name)) ||
      groupContainers.every((c) => c.labels[DISCOVERY_IGNORE_LABEL] === "true");

    const states = groupContainers.map((c) => c.state);
    const status: DiscoveredProject["status"] =
      states.every((s) => s !== "running")
        ? "stopped"
        : states.some((s) => s !== "running")
          ? "partial"
          : groupError
            ? "error"
            : "running";

    discovered.push({
      key,
      name: composeProject || key,
      serverId: server.id,
      serverName: server.name,
      serverSlug: server.slug,
      composeProject,
      workingDir: primary.workingDir,
      status,
      containers: details,
      databases: Array.from(allDbs).sort(),
      sizeBytes: totalSize,
      pgVersion: version,
      managedProjectId: managed?.id ?? null,
      ignored: ignoredFlag,
      error: groupError || undefined,
    });
  }

  return discovered.sort((a, b) => a.name.localeCompare(b.name));
}

export async function inspectForManualAdd(idOrName: string, server: ServerRow): Promise<{
  container: ContainerInfo;
  isPostgres: boolean;
  pgUser: string;
  pgDefaultDb: string | null;
  databases: Array<{ name: string; sizeBytes: number }>;
  pgVersion: string;
  error?: string;
}> {
  const { getContainer } = await import("./docker");
  const container = await getContainer(idOrName, server);
  const pgUser = pgUserFor(container);
  const pgDefaultDb = pgDefaultDbFor(container, pgUser);
  const isPostgres = isPostgresImage(container.image);
  let databases: Array<{ name: string; sizeBytes: number }> = [];
  let pgVersion = "";
  let error: string | undefined;
  if (container.state === "running" && isPostgres) {
    try {
      databases = await containerDatabases(container.id, pgUser, server);
      pgVersion = await postgresVersion(container.id, pgUser, server);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return { container, isPostgres, pgUser, pgDefaultDb, databases, pgVersion, error };
}

/**
 * Summarize every Compose project on a server, including those without PostgreSQL.
 */
export async function composeProjectSummary(server: ServerRow): Promise<{
  projects: ComposeProjectSummary[];
  total: number;
  withPostgres: number;
}> {
  const containers = await listAllContainers(server);
  const map = new Map<string, ComposeProjectSummary>();
  for (const container of containers) {
    if (!container.composeProject) continue;
    if (container.labels[DISCOVERY_IGNORE_LABEL] === "true") continue;
    const entry =
      map.get(container.composeProject) || {
        name: container.composeProject,
        serverId: server.id,
        serverName: server.name,
        containerCount: 0,
        running: 0,
        hasPostgres: false,
      };
    entry.containerCount += 1;
    if (container.state === "running") entry.running += 1;
    if (isPostgresImage(container.image)) entry.hasPostgres = true;
    map.set(container.composeProject, entry);
  }
  const projects = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  return {
    projects,
    total: projects.length,
    withPostgres: projects.filter((project) => project.hasPostgres).length,
  };
}
