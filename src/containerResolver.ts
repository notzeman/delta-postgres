import {
  getContainer,
  isPostgresImage,
  listAllContainers,
  type ContainerInfo,
} from "./docker";
import { pool, type Project, type ServerRow } from "./db";

export interface ResolveContainerResult {
  container: ContainerInfo;
  previous: { id: string | null; name: string | null };
  changed: boolean;
}

/**
 * Resolve the live container for a project.
 *
 * Container IDs are ephemeral: recreating a compose service changes the ID.
 * Names and compose labels are stable, so try those before falling back to a
 * server-wide discovery pass. Any change is persisted back to the project.
 */
export async function resolveProjectContainer(
  project: Project,
  server: ServerRow,
): Promise<ResolveContainerResult> {
  const previous = {
    id: project.container_id,
    name: project.container_name,
  };
  if (!project.container_name && !project.container_id && !project.compose_project) {
    throw new Error(
      `Project ${project.name} has no container name, ID, or compose project to resolve.`,
    );
  }

  const attemptErrors: string[] = [];
  let container: ContainerInfo | null = null;

  // 1. Stable container name.
  if (project.container_name) {
    try {
      container = await getContainer(project.container_name, server);
    } catch (error) {
      attemptErrors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // 2. Stored container ID (may work if a name was renamed).
  if (!container && project.container_id) {
    try {
      container = await getContainer(project.container_id, server);
    } catch (error) {
      attemptErrors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // 3. Compose discovery: match the PostgreSQL container on the same server.
  if (!container) {
    const containers = await listAllContainers(server);
    const postgres = containers.filter((candidate) => isPostgresImage(candidate.image));
    let candidates = project.compose_project
      ? postgres.filter((candidate) => candidate.composeProject === project.compose_project)
      : [];
    if (candidates.length === 0 && project.container_name) {
      const name = project.container_name.toLowerCase();
      candidates = postgres.filter(
        (candidate) =>
          candidate.name.toLowerCase().includes(name) ||
          name.includes(candidate.name.toLowerCase()),
      );
    }
    if (candidates.length === 0 && !project.compose_project) {
      candidates = postgres;
    }
    const running = candidates.filter((candidate) => candidate.state === "running");
    const poolToUse = running.length > 0 ? running : candidates;
    container =
      poolToUse.find((candidate) =>
        /postgres|db|database/i.test(candidate.composeService || ""),
      ) ||
      poolToUse[0] ||
      null;
  }

  if (!container) {
    throw new Error(
      `No matching PostgreSQL container found for ${project.name} on ${server.name}. ` +
        `Is the container running? ${attemptErrors.join(" ")}`.trim(),
    );
  }

  const changed =
    container.id !== project.container_id ||
    container.name !== project.container_name ||
    container.image !== project.container_image ||
    container.composeProject !== project.compose_project;

  if (changed) {
    await pool.query(
      `UPDATE projects SET container_id = $1, container_name = $2,
         container_image = $3, compose_project = $4, updated_at = now()
       WHERE id = $5`,
      [
        container.id,
        container.name,
        container.image,
        container.composeProject,
        project.id,
      ],
    );
  }

  return { container, previous, changed };
}
