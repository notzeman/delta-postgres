import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config";
import {
  pool,
  getProjects,
  getProject,
  getProjectBySlug,
  getArchives,
  getJobs,
  getJob,
  getSettings,
  setSetting,
  audit,
  getIgnoredProjects,
  countUsers,
  type Project,
} from "./db";
import {
  verifyCredentials,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  currentUser,
  getActor,
  checkLoginRate,
  resetLoginRate,
} from "./auth";
import {
  listAllContainers,
  isPostgresImage,
  dockerVersion,
  containerDatabases,
  postgresVersion,
} from "./docker";
import { discoverProjects, inspectForManualAdd, composeProjectSummary } from "./discovery";
import { autoImportDiscoveredProjects } from "./autoDiscover";
import { resolveProjectContainer } from "./containerResolver";
import {
  listServers,
  getServer,
  getLocalServer,
  serverStatus,
  toPublicServer,
  type ServerRow,
} from "./servers";
import { encryptSecret } from "./secrets";
import {
  borgVersion,
  repoSizeBytes,
  invalidateRepoSize,
  projectBackupDir,
  listArchiveFiles,
  listArchives,
  createArchive,
  deleteArchive,
  checkArchive,
  exportArchiveStream,
  exportRepoStream,
  exportAllStream,
  importArchiveFromFile,
  restoreDatabase,
} from "./borg";
import {
  createJob,
  enqueueProject,
  enqueueAll,
  cancelJob,
  readJobLog,
  runningJobCount,
  syncProjectArchives,
} from "./jobs";
import {
  computeNextRun,
  recomputeProjectSchedule,
  recomputeAllSchedules,
} from "./scheduler";
import { runCommand, slugify, formatBytes, ensureDir, rmrf, fileSize, hashFile } from "./utils";

function sendError(reply: FastifyReply, code: number, message: string) {
  return reply.code(code).send({ error: message });
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function projectId(request: FastifyRequest): number {
  const value = Number((request.params as any).id);
  return Number.isFinite(value) ? value : 0;
}

function archiveName(request: FastifyRequest): string {
  return decodeURIComponent((request.params as any).name);
}

async function requireProject(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Project | null> {
  const project = await getProject(projectId(request));
  if (!project) {
    sendError(reply, 404, "Project not found");
    return null;
  }
  return project;
}

function queryServerId(request: FastifyRequest): number | undefined {
  const value = Number((request.query as any)?.serverId);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function requireServer(
  id: number,
  reply: FastifyReply,
): Promise<ServerRow | null> {
  const server = await getServer(id);
  if (!server) {
    sendError(reply, 404, "Docker server not found");
    return null;
  }
  return server;
}

function safeDbFile(db: string): string {
  return `databases/${db.replace(/[^a-zA-Z0-9_.-]/g, "_")}.dump`;
}

export async function registerApi(app: FastifyInstance): Promise<void> {
  // ---------- Auth ----------
  app.post("/api/auth/login", async (request, reply) => {
    const ip = request.ip;
    if (!checkLoginRate(ip)) {
      return sendError(reply, 429, "Too many login attempts. Try again in a minute.");
    }
    const users = await countUsers();
    if (users === 0) {
      return sendError(
        reply,
        503,
        "No admin user configured. Run: docker compose exec dashboard npm run create-admin",
      );
    }
    const body = z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .safeParse(request.body);
    if (!body.success) return sendError(reply, 400, "Username and password are required");
    const ok = await verifyCredentials(body.data.username, body.data.password);
    if (!ok) {
      audit("anonymous", "login.failed", body.data.username).catch(() => {});
      return sendError(reply, 401, "Invalid credentials");
    }
    resetLoginRate(ip);
    const token = signSession(body.data.username);
    setSessionCookie(reply, token);
    await audit(body.data.username, "login.success", body.data.username);
    return { user: { username: body.data.username } };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    clearSessionCookie(reply);
    await audit(getActor(request), "logout");
    return { ok: true };
  });

  app.get("/api/auth/me", async (request) => {
    const user = currentUser(request);
    return { user };
  });

  // ---------- Health ----------
  app.get("/api/health", async () => {
    const settings = await getSettings();
    const checks: Record<string, unknown> = {
      time: new Date().toISOString(),
      appVersion: config.appVersion,
      timezone: String(settings.timezone || config.timezone),
      worker: {
        running: runningJobCount(),
        concurrency: Number(settings.concurrency || config.concurrency),
      },
    };
    try {
      await pool.query("SELECT 1");
      checks.database = { ok: true };
    } catch (error) {
      checks.database = { ok: false, error: String(error) };
    }
    try {
      checks.docker = { ok: true, ...(await dockerVersion()) };
    } catch (error) {
      checks.docker = { ok: false, error: String(error) };
    }
    try {
      checks.borg = { ok: true, version: await borgVersion() };
    } catch (error) {
      checks.borg = { ok: false, error: String(error) };
    }
    try {
      const stat: any = (fs as any).statfsSync(config.backupRoot);
      const total = Number(stat.blocks) * Number(stat.bsize);
      const free = Number(stat.bavail) * Number(stat.bsize);
      checks.disk = {
        ok: free > 1024 * 1024 * 1024,
        total,
        free,
        usedPct: total ? Math.round(((total - free) / total) * 100) : 0,
      };
    } catch (error) {
      checks.disk = { ok: false, error: String(error) };
    }
    return checks;
  });

  // ---------- Docker servers ----------
  app.get("/api/servers", async () => {
    const servers = await listServers();
    const counts = await pool.query<{ server_id: number; count: string }>(
      `SELECT server_id, count(*)::text AS count FROM projects
       WHERE ignored = false GROUP BY server_id`,
    );
    const countMap = new Map(counts.rows.map((row) => [row.server_id, Number(row.count)]));
    const result = await Promise.all(
      servers.map(async (server) => {
        const status = server.enabled
          ? await serverStatus(server)
          : { online: false, error: "Disabled" };
        return {
          ...toPublicServer(server),
          status,
          projectCount: countMap.get(server.id) || 0,
        };
      }),
    );
    return { servers: result };
  });

  app.post("/api/servers", async (request, reply) => {
    const schema = z.object({
      name: z.string().min(1).max(80),
      type: z.enum(["local", "tcp", "ssh"]),
      protocol: z.enum(["socket", "http", "https", "ssh"]).optional(),
      host: z.string().nullable().optional(),
      port: z.number().int().min(1).max(65535).nullable().optional(),
      socketPath: z.string().nullable().optional(),
      sshUsername: z.string().nullable().optional(),
      sshPassword: z.string().nullable().optional(),
      tlsCa: z.string().nullable().optional(),
      tlsCert: z.string().nullable().optional(),
      tlsKey: z.string().nullable().optional(),
      tlsVerify: z.boolean().optional(),
      enabled: z.boolean().optional(),
      skipTest: z.boolean().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || "Invalid body");
    const body = parsed.data;

    if (body.type === "local") {
      const local = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM servers WHERE type = 'local'`,
      );
      if (Number(local.rows[0]?.count || 0) > 0) {
        return sendError(reply, 400, "A local Docker server already exists");
      }
    }
    if (body.type === "tcp" && !body.host) {
      return sendError(reply, 400, "Host is required for a TCP Docker server");
    }
    if (body.type === "ssh") {
      if (!body.host) return sendError(reply, 400, "Server IP or hostname is required");
      if (!body.sshUsername) return sendError(reply, 400, "SSH username is required");
      if (!body.sshPassword) return sendError(reply, 400, "SSH password is required");
    }

    const protocol =
      body.type === "local" ? "socket" : body.type === "ssh" ? "ssh" : body.protocol || "http";
    const port =
      body.type === "local"
        ? null
        : body.type === "ssh"
          ? body.port ?? 22
          : body.port ?? (protocol === "https" ? 2376 : 2375);
    const temp: ServerRow = {
      id: 0,
      name: body.name,
      slug: slugify(body.name),
      type: body.type,
      protocol,
      host: body.type === "tcp" || body.type === "ssh" ? body.host || null : null,
      port,
      socket_path: body.type === "local" ? body.socketPath || config.dockerSocket : null,
      ssh_username: body.type === "ssh" ? body.sshUsername || null : null,
      ssh_password: body.type === "ssh" ? body.sshPassword || null : null,
      tls_ca: body.tlsCa || null,
      tls_cert: body.tlsCert || null,
      tls_key: body.tlsKey || null,
      tls_verify: body.tlsVerify !== false,
      enabled: body.enabled !== false,
      created_at: "",
      updated_at: "",
    };

    let status: any = null;
    if (!body.skipTest) {
      status = await serverStatus(temp);
      if (!status.online) {
        return sendError(reply, 400, `Connection failed: ${status.error || "unknown error"}`);
      }
    }

    const existing = await pool.query<{ slug: string }>(`SELECT slug FROM servers`);
    const slugs = new Set(existing.rows.map((row) => row.slug));
    let slug = temp.slug;
    let suffix = 1;
    while (slugs.has(slug)) slug = `${temp.slug}-${suffix++}`;

    const { rows } = await pool.query<ServerRow>(
      `INSERT INTO servers(name, slug, type, protocol, host, port, socket_path,
         ssh_username, ssh_password, tls_ca, tls_cert, tls_key, tls_verify, enabled)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        temp.name,
        slug,
        temp.type,
        temp.protocol,
        temp.host,
        temp.port,
        temp.socket_path,
        temp.ssh_username,
        encryptSecret(temp.ssh_password),
        encryptSecret(temp.tls_ca),
        encryptSecret(temp.tls_cert),
        encryptSecret(temp.tls_key),
        temp.tls_verify,
        temp.enabled,
      ],
    );
    await audit(getActor(request), "server.create", slug, {
      type: temp.type,
      host: temp.host,
    });
    return reply.code(201).send({
      server: { ...toPublicServer(rows[0]), status: status || (await serverStatus(rows[0])) },
    });
  });

  app.patch("/api/servers/:id", async (request, reply) => {
    const id = Number((request.params as any).id);
    const server = await getServer(id);
    if (!server) return sendError(reply, 404, "Docker server not found");
    const schema = z.object({
      name: z.string().min(1).max(80).optional(),
      host: z.string().nullable().optional(),
      port: z.number().int().min(1).max(65535).nullable().optional(),
      protocol: z.enum(["socket", "http", "https", "ssh"]).optional(),
      socketPath: z.string().nullable().optional(),
      sshUsername: z.string().nullable().optional(),
      sshPassword: z.string().nullable().optional(),
      tlsCa: z.string().nullable().optional(),
      tlsCert: z.string().nullable().optional(),
      tlsKey: z.string().nullable().optional(),
      tlsVerify: z.boolean().optional(),
      enabled: z.boolean().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || "Invalid body");
    const body: any = parsed.data;
    if (server.type === "local") {
      const forbidden = ["host", "port", "protocol", "socketPath", "sshUsername", "sshPassword", "tlsCa", "tlsCert", "tlsKey", "tlsVerify"];
      if (forbidden.some((key) => body[key] !== undefined)) {
        return sendError(reply, 400, "The local server connection cannot be changed");
      }
    }

    const updates: string[] = [];
    const params: any[] = [];
    const add = (column: string, value: any) => {
      params.push(value);
      updates.push(`${column} = $${params.length}`);
    };
    if (body.name !== undefined) add("name", body.name);
    if (body.host !== undefined) add("host", body.host);
    if (body.port !== undefined) add("port", body.port);
    if (body.protocol !== undefined) add("protocol", body.protocol);
    if (body.socketPath !== undefined) add("socket_path", body.socketPath);
    if (body.sshUsername !== undefined) add("ssh_username", body.sshUsername);
    if (body.sshPassword) add("ssh_password", encryptSecret(body.sshPassword));
    if (body.tlsCa !== undefined) add("tls_ca", body.tlsCa ? encryptSecret(body.tlsCa) : null);
    if (body.tlsCert !== undefined) add("tls_cert", body.tlsCert ? encryptSecret(body.tlsCert) : null);
    if (body.tlsKey !== undefined) add("tls_key", body.tlsKey ? encryptSecret(body.tlsKey) : null);
    if (body.tlsVerify !== undefined) add("tls_verify", body.tlsVerify);
    if (body.enabled !== undefined) add("enabled", body.enabled);
    if (!updates.length) {
      return { server: { ...toPublicServer(server), status: await serverStatus(server) } };
    }
    params.push(id);
    const { rows } = await pool.query<ServerRow>(
      `UPDATE servers SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${params.length} RETURNING *`,
      params,
    );
    const auditMeta: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      if (["sshPassword", "tlsCa", "tlsCert", "tlsKey"].includes(key)) {
        auditMeta[key] = value ? "[redacted]" : null;
      } else {
        auditMeta[key] = value;
      }
    }
    await audit(getActor(request), "server.update", server.slug, auditMeta);
    return {
      server: { ...toPublicServer(rows[0]), status: await serverStatus(rows[0]) },
    };
  });

  app.delete("/api/servers/:id", async (request, reply) => {
    const id = Number((request.params as any).id);
    const server = await getServer(id);
    if (!server) return sendError(reply, 404, "Docker server not found");
    if (server.type === "local") return sendError(reply, 400, "The local server cannot be removed");
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM projects WHERE server_id = $1`,
      [id],
    );
    const projectCount = Number(count.rows[0]?.count || 0);
    const force = (request.query as any)?.force === "true";
    if (projectCount > 0 && !force) {
      return reply.code(409).send({
        error: `This server still has ${projectCount} project(s). Re-send with force=true to remove the server and its project records.`,
        projectCount,
      });
    }
    await pool.query(`DELETE FROM servers WHERE id = $1`, [id]);
    await audit(getActor(request), "server.delete", server.slug, { projectCount, force });
    return {
      ok: true,
      note: "Server removed. Project records were removed; Borg repository files were kept on disk.",
    };
  });

  app.post("/api/servers/test", async (request, reply) => {
    const schema = z.object({
      id: z.number().int().positive().optional(),
      type: z.enum(["local", "tcp", "ssh"]).default("tcp"),
      protocol: z.enum(["socket", "http", "https", "ssh"]).optional(),
      host: z.string().nullable().optional(),
      port: z.number().int().min(1).max(65535).nullable().optional(),
      socketPath: z.string().nullable().optional(),
      sshUsername: z.string().nullable().optional(),
      sshPassword: z.string().nullable().optional(),
      tlsCa: z.string().nullable().optional(),
      tlsCert: z.string().nullable().optional(),
      tlsKey: z.string().nullable().optional(),
      tlsVerify: z.boolean().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || "Invalid body");
    const body = parsed.data;
    let sshPassword = body.sshPassword || null;
    if (body.type === "ssh" && !sshPassword && body.id) {
      const stored = await getServer(body.id);
      if (stored?.type === "ssh") {
        sshPassword = stored.ssh_password;
        if (!body.sshUsername) body.sshUsername = stored.ssh_username;
        if (!body.host) body.host = stored.host;
      }
    }
    if (body.type === "ssh" && (!body.host || !body.sshUsername || !sshPassword)) {
      return sendError(reply, 400, "SSH requires host, username, and password");
    }
    const protocol =
      body.type === "local" ? "socket" : body.type === "ssh" ? "ssh" : body.protocol || "http";
    const temp: ServerRow = {
      id: 0,
      name: "test",
      slug: "test",
      type: body.type,
      protocol,
      host: body.type === "tcp" || body.type === "ssh" ? body.host || null : null,
      port:
        body.type === "local"
          ? null
          : body.type === "ssh"
            ? body.port ?? 22
            : body.port ?? (protocol === "https" ? 2376 : 2375),
      socket_path: body.type === "local" ? body.socketPath || config.dockerSocket : null,
      ssh_username: body.type === "ssh" ? body.sshUsername || null : null,
      ssh_password: body.type === "ssh" ? sshPassword : null,
      tls_ca: body.tlsCa || null,
      tls_cert: body.tlsCert || null,
      tls_key: body.tlsKey || null,
      tls_verify: body.tlsVerify !== false,
      enabled: true,
      created_at: "",
      updated_at: "",
    };
    const status = await serverStatus(temp);
    return status;
  });

  app.post("/api/servers/:id/test", async (request, reply) => {
    const server = await getServer(Number((request.params as any).id));
    if (!server) return sendError(reply, 404, "Docker server not found");
    return serverStatus(server);
  });

  app.post("/api/servers/:id/scan", async (request, reply) => {
    const server = await getServer(Number((request.params as any).id));
    if (!server) return sendError(reply, 404, "Docker server not found");
    try {
      const discovered = await discoverProjects(server);
      const added = await autoImportDiscoveredProjects(discovered);
      return {
        ok: true,
        added,
        projects: await getProjects(server.id),
      };
    } catch (error) {
      return sendError(
        reply,
        500,
        error instanceof Error ? error.message : "Scan failed",
      );
    }
  });

  // ---------- Stats ----------
  app.get("/api/stats", async (request) => {
    const serverId = queryServerId(request);
    const projects = await getProjects(serverId);
    const projectIds = projects.map((p) => p.id);
    const filterIds = serverId ? projectIds : null;
    const settings = await getSettings();
    const timezone = String(settings.timezone || config.timezone);
    const [allJobs, totals, lastSuccess, last24, daily] = await Promise.all([
      getJobs(200),
      pool.query<{
        archives: string;
        original: string;
        deduplicated: string;
        compressed: string;
      }>(
        `SELECT count(*)::text AS archives,
                COALESCE(sum(original_size), 0)::text AS original,
                COALESCE(sum(deduplicated_size), 0)::text AS deduplicated,
                COALESCE(sum(size_bytes), 0)::text AS compressed
         FROM archives
         WHERE ($1::int[] IS NULL OR project_id = ANY($1::int[]))`,
        [filterIds],
      ),
      pool.query<{ at: string | null }>(
        `SELECT max(finished_at) AS at FROM backup_jobs
         WHERE status = 'success'
           AND ($1::int[] IS NULL OR project_id = ANY($1::int[]))`,
        [filterIds],
      ),
      pool.query<{ status: string; count: string }>(
        `SELECT status, count(*)::text AS count FROM backup_jobs
         WHERE created_at > now() - interval '24 hours'
           AND ($1::int[] IS NULL OR project_id = ANY($1::int[]))
         GROUP BY status`,
        [filterIds],
      ),
      // One point per day (in the configured timezone) across all selected projects.
      // float8 casts make pg return numbers instead of BIGINT strings.
      pool.query<{ day: string; archives: number; original_size: number; deduplicated_size: number }>(
        `SELECT to_char((a.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day,
                count(*)::int AS archives,
                coalesce(sum(a.original_size), 0)::float8 AS original_size,
                coalesce(sum(a.deduplicated_size), 0)::float8 AS deduplicated_size
         FROM archives a
         WHERE ($1::int[] IS NULL OR a.project_id = ANY($1::int[]))
           AND a.created_at >= now() - interval '30 days'
         GROUP BY 1
         ORDER BY 1`,
        [filterIds, timezone],
      ),
    ]);
    const jobs = allJobs
      .filter((job) => !serverId || projectIds.includes(job.project_id))
      .slice(0, 12);
    return {
      serverId: serverId || null,
      projects: {
        total: projects.length,
        enabled: projects.filter((p) => p.enabled).length,
        failing: projects.filter((p) => p.last_status === "failed").length,
      },
      archives: Number(totals.rows[0]?.archives || 0),
      originalBytes: Number(totals.rows[0]?.original || 0),
      deduplicatedBytes: Number(totals.rows[0]?.deduplicated || 0),
      compressedBytes: Number(totals.rows[0]?.compressed || 0),
      lastSuccessAt: lastSuccess.rows[0]?.at || null,
      last24: Object.fromEntries(last24.rows.map((r) => [r.status, Number(r.count)])),
      recentJobs: jobs,
      storageDaily: daily.rows,
    };
  });

  app.get("/api/stats/repo-size", async (request) => {
    const serverId = queryServerId(request);
    const projects = await getProjects(serverId);
    const sizes = await Promise.all(projects.map((project) => repoSizeBytes(project)));
    return { repoBytes: sizes.reduce((total, size) => total + size, 0) };
  });

  // ---------- Discovery ----------
  app.get("/api/discovery", async (request) => {
    const serverId = queryServerId(request);
    let servers = await listServers();
    servers = serverId
      ? servers.filter((server) => server.id === serverId)
      : servers.filter((server) => server.enabled);
    const settings = await getSettings();
    const managed = await getProjects(serverId);
    const managedKeys = new Set(managed.map((p) => `${p.server_id}:${p.slug}`));

    const allDiscovered: any[] = [];
    let autoAdded = 0;
    let composeProjects: any[] = [];
    let total = 0;
    let withPostgres = 0;

    for (const server of servers) {
      try {
        let discovered = await discoverProjects(server);
        const added = await autoImportDiscoveredProjects(discovered);
        if (added > 0) discovered = await discoverProjects(server);
        autoAdded += added;
        allDiscovered.push(...discovered);
        const compose = await composeProjectSummary(server);
        composeProjects.push(...compose.projects);
        total += compose.total;
        withPostgres += compose.withPostgres;
      } catch (error) {
        request.log.error(error, `Discovery failed for server ${server.name}`);
      }
    }

    return {
      projects: allDiscovered.map((p) => ({
        ...p,
        canAdd: !p.managedProjectId && !p.ignored,
        alreadyManaged: p.managedProjectId
          ? true
          : managedKeys.has(`${p.serverId}:${slugify(p.name)}`),
      })),
      autoAdded,
      autoAddProjects: settings.autoAddProjects !== false,
      composeProjects,
      summary: { total, withPostgres },
      servers: servers.map(toPublicServer),
    };
  });

  app.post("/api/discovery/ignore", async (request, reply) => {
    const body = z
      .object({
        serverId: z.number().int().positive(),
        composeProject: z.string().min(1),
        ignore: z.boolean(),
      })
      .safeParse(request.body);
    if (!body.success) return sendError(reply, 400, "serverId, composeProject and ignore are required");
    const server = await requireServer(body.data.serverId, reply);
    if (!server) return;
    if (body.data.ignore) {
      await pool.query(
        `INSERT INTO ignored_projects(server_id, compose_project) VALUES($1, $2)
         ON CONFLICT DO NOTHING`,
        [server.id, body.data.composeProject],
      );
    } else {
      await pool.query(
        `DELETE FROM ignored_projects WHERE server_id = $1 AND compose_project = $2`,
        [server.id, body.data.composeProject],
      );
    }
    await audit(
      getActor(request),
      body.data.ignore ? "discovery.ignore" : "discovery.unignore",
      `${server.slug}/${body.data.composeProject}`,
    );
    return { ok: true };
  });

  app.get("/api/containers", async (request, reply) => {
    const serverId = queryServerId(request);
    const server = serverId ? await getServer(serverId) : await getLocalServer();
    if (!server) return sendError(reply, 404, "Docker server not found");
    const containers = await listAllContainers(server);
    return {
      serverId: server.id,
      containers: containers
        .filter((c) => c.labels["backup.ignore"] !== "true")
        .map((c) => ({
          id: c.id,
          name: c.name,
          image: c.image,
          state: c.state,
          composeProject: c.composeProject,
          composeService: c.composeService,
          isPostgres: isPostgresImage(c.image),
          pgUser: c.env.POSTGRES_USER || "postgres",
          pgDefaultDb: c.env.POSTGRES_DB || null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  app.post("/api/projects/inspect", async (request, reply) => {
    const body = z
      .object({
        container: z.string().min(1),
        serverId: z.number().int().positive().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return sendError(reply, 400, "Container is required");
    const server = body.data.serverId
      ? await getServer(body.data.serverId)
      : await getLocalServer();
    if (!server) return sendError(reply, 404, "Docker server not found");
    try {
      const info = await inspectForManualAdd(body.data.container, server);
      return {
        serverId: server.id,
        serverName: server.name,
        container: {
          id: info.container.id,
          name: info.container.name,
          image: info.container.image,
          state: info.container.state,
          composeProject: info.container.composeProject,
        },
        isPostgres: info.isPostgres,
        pgUser: info.pgUser,
        pgDefaultDb: info.pgDefaultDb,
        databases: info.databases,
        pgVersion: info.pgVersion,
        error: info.error,
      };
    } catch (error) {
      return sendError(reply, 404, error instanceof Error ? error.message : "Container not found");
    }
  });

  // ---------- Projects ----------
  app.get("/api/projects", async (request) => {
    const serverId = queryServerId(request);
    const includeIgnored = (request.query as any)?.includeIgnored === "1";
    const projects = await getProjects(serverId, includeIgnored);
    const servers = await listServers();
    const serverMap = new Map(servers.map((server) => [server.id, server]));
    const containersByServer = new Map<number, any[]>();
    await Promise.all(
      [...new Set(projects.map((project) => project.server_id))].map(async (id) => {
        const server = serverMap.get(id);
        if (!server) return;
        containersByServer.set(id, await listAllContainers(server).catch(() => []));
      }),
    );
    const result = await Promise.all(
      projects.map(async (project) => {
        const containers = containersByServer.get(project.server_id) || [];
        const byId = new Map(containers.map((c) => [c.id, c]));
        const byName = new Map(containers.map((c) => [c.name, c]));
        const container =
          (project.container_id ? byId.get(project.container_id) : undefined) ||
          (project.container_name ? byName.get(project.container_name) : undefined);
        const [archives, lastJob, repoBytes] = await Promise.all([
          pool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM archives WHERE project_id = $1`,
            [project.id],
          ),
          pool.query(
            `SELECT id, status, trigger, started_at, finished_at, error, size_bytes
             FROM backup_jobs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [project.id],
          ),
          repoSizeBytes(project),
        ]);
        return {
          ...project,
          repoBytes,
          archiveCount: Number(archives.rows[0]?.count || 0),
          containerState: container?.state || "missing",
          containerImage: container?.image || project.container_image,
          lastJob: lastJob.rows[0] || null,
        };
      }),
    );
    return { projects: result };
  });

  app.post("/api/projects", async (request, reply) => {
    const schema = z.object({
      name: z.string().min(1).max(120),
      serverId: z.number().int().positive().optional(),
      containerId: z.string().optional(),
      containerName: z.string().optional(),
      pgUser: z.string().optional(),
      pgDefaultDb: z.string().nullable().optional(),
      databases: z.array(z.string()).nullable().optional(),
      scheduleCron: z.string().nullable().optional(),
      keepDaily: z.number().int().min(0).nullable().optional(),
      keepWeekly: z.number().int().min(0).nullable().optional(),
      keepMonthly: z.number().int().min(0).nullable().optional(),
      compression: z.string().optional(),
      notes: z.string().nullable().optional(),
      force: z.boolean().optional(),
      source: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || "Invalid body");
    const body = parsed.data;
    const ref = body.containerId || body.containerName;
    if (!ref) return sendError(reply, 400, "A container is required");
    const server = body.serverId
      ? await getServer(body.serverId)
      : await getLocalServer();
    if (!server) return sendError(reply, 404, "Docker server not found");

    let info;
    try {
      info = await inspectForManualAdd(ref, server);
    } catch (error) {
      return sendError(reply, 404, error instanceof Error ? error.message : "Container not found");
    }
    if (!info.isPostgres && !body.force) {
      return sendError(
        reply,
        400,
        "Container does not look like a PostgreSQL container. Use force=true to add it anyway.",
      );
    }
    const pgUser = body.pgUser || info.pgUser;
    const settings = await getSettings();
    const timezone = String(settings.timezone || config.timezone);
    const cron = body.scheduleCron || String(settings.globalCron || config.defaultCron);
    if (computeNextRun(cron, new Date(), timezone) === null) {
      return sendError(reply, 400, "Invalid cron expression");
    }

    let slug = slugify(body.name);
    const existing = await getProjectBySlug(slug, server.id);
    if (existing) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const { rows } = await pool.query<Project>(
      `INSERT INTO projects(name, slug, source, enabled, server_id, container_id,
        container_name, container_image, compose_project, pg_user, pg_default_db,
        databases, schedule_cron, keep_daily, keep_weekly, keep_monthly, compression,
        notes, next_run_at)
       VALUES($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        body.name,
        slug,
        body.source || "manual",
        server.id,
        info.container.id,
        info.container.name,
        info.container.image,
        info.container.composeProject,
        pgUser,
        body.pgDefaultDb ?? info.pgDefaultDb,
        body.databases ? JSON.stringify(body.databases) : null,
        body.scheduleCron ?? null,
        body.keepDaily ?? null,
        body.keepWeekly ?? null,
        body.keepMonthly ?? null,
        body.compression || "auto,zstd,3",
        body.notes ?? null,
        computeNextRun(cron, new Date(), timezone),
      ],
    );
    await audit(getActor(request), "project.create", rows[0].slug, {
      container: info.container.name,
      server: server.name,
    });
    // A manually created project should override a previous "ignore" decision.
    for (const key of [info.container.composeProject, info.container.name].filter(Boolean)) {
      await pool.query(
        `DELETE FROM ignored_projects WHERE server_id = $1 AND compose_project = $2`,
        [server.id, key],
      );
    }
    const created = await getProject(rows[0].id);
    return reply.code(201).send({ project: created || rows[0] });
  });

  app.get("/api/projects/:id", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const archives = await getArchives(project.id);
    const jobs = await pool.query(
      `SELECT * FROM backup_jobs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [project.id],
    );
    let container: any = null;
    let liveDatabases: Array<{ name: string; sizeBytes: number }> = [];
    let version = "";
    let resolvedProject = project;
    const server = await getServer(project.server_id);
    try {
      const result = await resolveProjectContainer(project, server!);
      container = result.container;
      if (result.changed) {
        resolvedProject = (await getProject(project.id)) || project;
      }
      if (container.state === "running") {
        liveDatabases = await containerDatabases(container.id, project.pg_user, server);
        version = await postgresVersion(container.id, project.pg_user, server);
      }
    } catch {
      /* container may be missing */
    }
    return {
      project: { ...resolvedProject, repoBytes: await repoSizeBytes(resolvedProject) },
      server: server ? toPublicServer(server) : null,
      archives,
      jobs: jobs.rows,
      container: container
        ? {
            id: container.id,
            name: container.name,
            image: container.image,
            state: container.state,
            composeProject: container.composeProject,
            databases: liveDatabases,
            pgVersion: version,
          }
        : null,
    };
  });

  app.patch("/api/projects/:id", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const schema = z.object({
      name: z.string().min(1).max(120).optional(),
      enabled: z.boolean().optional(),
      ignored: z.boolean().optional(),
      pgUser: z.string().optional(),
      pgDefaultDb: z.string().nullable().optional(),
      databases: z.array(z.string()).nullable().optional(),
      scheduleCron: z.string().nullable().optional(),
      keepDaily: z.number().int().min(0).nullable().optional(),
      keepWeekly: z.number().int().min(0).nullable().optional(),
      keepMonthly: z.number().int().min(0).nullable().optional(),
      compression: z.string().optional(),
      notes: z.string().nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || "Invalid body");
    const body = parsed.data;
    const settings = await getSettings();
    const timezone = String(settings.timezone || config.timezone);
    if (body.scheduleCron && computeNextRun(body.scheduleCron, new Date(), timezone) === null) {
      return sendError(reply, 400, "Invalid cron expression");
    }
    const nextRun = body.scheduleCron
      ? computeNextRun(body.scheduleCron, new Date(), timezone)
      : body.scheduleCron === null
        ? computeNextRun(
            String(settings.globalCron || config.defaultCron),
            new Date(),
            timezone,
          )
        : project.next_run_at;

    const { rows } = await pool.query<Project>(
      `UPDATE projects SET
        name = $1, enabled = $2, pg_user = $3, pg_default_db = $4,
        databases = $5, schedule_cron = $6, keep_daily = $7, keep_weekly = $8,
        keep_monthly = $9, compression = $10, notes = $11, next_run_at = $12,
        ignored = $13, updated_at = now()
       WHERE id = $14 RETURNING *`,
      [
        body.name ?? project.name,
        body.enabled ?? project.enabled,
        body.pgUser ?? project.pg_user,
        body.pgDefaultDb === undefined ? project.pg_default_db : body.pgDefaultDb,
        body.databases === undefined
          ? project.databases
            ? JSON.stringify(project.databases)
            : null
          : body.databases
            ? JSON.stringify(body.databases)
            : null,
        body.scheduleCron === undefined ? project.schedule_cron : body.scheduleCron,
        body.keepDaily === undefined ? project.keep_daily : body.keepDaily,
        body.keepWeekly === undefined ? project.keep_weekly : body.keepWeekly,
        body.keepMonthly === undefined ? project.keep_monthly : body.keepMonthly,
        body.compression ?? project.compression,
        body.notes === undefined ? project.notes : body.notes,
        nextRun,
        body.ignored === undefined ? project.ignored : body.ignored,
        project.id,
      ],
    );
    const ignoreKey = project.compose_project || project.container_name;
    if (body.ignored === false) {
      if (ignoreKey) {
        await pool.query(
          `DELETE FROM ignored_projects WHERE server_id = $1 AND compose_project = $2`,
          [project.server_id, ignoreKey],
        );
      }
      await recomputeProjectSchedule(project.id);
    } else if (body.ignored === true && ignoreKey) {
      await pool.query(
        `INSERT INTO ignored_projects(server_id, compose_project) VALUES($1, $2)
         ON CONFLICT DO NOTHING`,
        [project.server_id, ignoreKey],
      );
    }
    await audit(getActor(request), "project.update", project.slug, body);
    const updated = await getProject(project.id);
    return { project: updated || rows[0] };
  });

  app.delete("/api/projects/:id", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    // Soft-delete: keep the project, archives, jobs, and repository so it can
    // be restored from the Ignored section.
    await pool.query(
      `UPDATE projects SET ignored = true, updated_at = now() WHERE id = $1`,
      [project.id],
    );
    // Remember the decision so auto-discovery does not re-add it.
    const ignoreKey = project.compose_project || project.container_name;
    if (ignoreKey) {
      await pool.query(
        `INSERT INTO ignored_projects(server_id, compose_project) VALUES($1, $2)
         ON CONFLICT DO NOTHING`,
        [project.server_id, ignoreKey],
      );
    }
    await audit(getActor(request), "project.ignore", project.slug, {
      ignored: ignoreKey ? [ignoreKey] : [],
    });
    return {
      ok: true,
      note: "Project moved to Ignored. Its archives, jobs, and Borg repository were kept.",
    };
  });

  app.post("/api/projects/:id/refresh-container", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const server = await getServer(project.server_id);
    if (!server) return sendError(reply, 404, "Docker server not found");
    try {
      const result = await resolveProjectContainer(project, server);
      await audit(getActor(request), "project.refresh_container", project.slug, {
        previous: result.previous,
        current: { id: result.container.id, name: result.container.name },
        changed: result.changed,
      });
      const updated = await getProject(project.id);
      return {
        ok: true,
        changed: result.changed,
        previous: result.previous,
        container: {
          id: result.container.id,
          name: result.container.name,
          image: result.container.image,
          state: result.container.state,
          composeProject: result.container.composeProject,
        },
        project: updated,
      };
    } catch (error) {
      return sendError(
        reply,
        404,
        error instanceof Error ? error.message : "No matching container found",
      );
    }
  });

  // ---------- Backups ----------
  app.post("/api/projects/:id/backup", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    if (project.ignored) return sendError(reply, 400, "Project is in the Ignored section. Restore it first.");
    if (!project.enabled) return sendError(reply, 400, "Project is disabled");
    const job = await createJob(project.id, "manual");
    await audit(getActor(request), "backup.manual", project.slug, { job: job.id });
    return reply.code(202).send({ job });
  });

  app.post("/api/backups", async (request) => {
    const body = z
      .object({ serverId: z.number().int().positive().optional() })
      .safeParse(request.body || {});
    const serverId = body.success ? body.data.serverId : undefined;
    const jobs = await enqueueAll("manual", serverId);
    await audit(getActor(request), "backup.manual.all", undefined, {
      jobs: jobs.length,
      serverId: serverId || null,
    });
    return { jobs };
  });

  app.get("/api/jobs", async (request) => {
    const query = request.query as any;
    const limit = Math.min(Number(query.limit || 100), 500);
    return { jobs: await getJobs(limit) };
  });

  app.get("/api/jobs/:id", async (request, reply) => {
    const job = await getJob(Number((request.params as any).id));
    if (!job) return sendError(reply, 404, "Job not found");
    return { job, log: readJobLog(job.id) };
  });

  app.get("/api/jobs/:id/log", async (request, reply) => {
    const job = await getJob(Number((request.params as any).id));
    if (!job) return sendError(reply, 404, "Job not found");
    return { log: readJobLog(job.id) };
  });

  app.post("/api/jobs/:id/cancel", async (request, reply) => {
    const id = Number((request.params as any).id);
    const job = await getJob(id);
    if (!job) return sendError(reply, 404, "Job not found");
    cancelJob(id);
    await audit(getActor(request), "job.cancel", String(id));
    return { ok: true };
  });

  // ---------- Archives ----------
  app.get("/api/projects/:id/archives", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const query = request.query as any;
    if (query.sync === "1") {
      try {
        await syncProjectArchives(project);
      } catch (error) {
        return sendError(reply, 500, error instanceof Error ? error.message : "Sync failed");
      }
    }
    return { archives: await getArchives(project.id) };
  });

  app.post("/api/projects/:id/archives/sync", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    try {
      await syncProjectArchives(project);
      return { archives: await getArchives(project.id) };
    } catch (error) {
      return sendError(reply, 500, error instanceof Error ? error.message : "Sync failed");
    }
  });

  app.get("/api/projects/:id/archives/:name/files", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const name = archiveName(request);
    try {
      return { files: await listArchiveFiles(project, name) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to list archive";
      if (/does not exist|not found|no archive/i.test(message)) {
        await pool.query(`DELETE FROM archives WHERE project_id = $1 AND name = $2`, [
          project.id,
          name,
        ]);
        return sendError(
          reply,
          404,
          "Archive is no longer in the Borg repository. Refresh the archive list and choose another archive.",
        );
      }
      return sendError(reply, 500, message);
    }
  });

  app.get("/api/projects/:id/archives/:name/databases", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const name = archiveName(request);
    try {
      const files = await listArchiveFiles(project, name);
      const databases = files
        .map((file) => ({
          ...file,
          path: file.path.replace(/^\.\//, ""),
        }))
        .filter(
          (file) =>
            file.type === "file" &&
            /^databases\/.+\.(dump|sql|backup|tar)$/i.test(file.path),
        )
        .map((file) => {
          const base = file.path.slice("databases/".length);
          const ext = (base.split(".").pop() || "").toLowerCase();
          return {
            name: base.slice(0, -(ext.length + 1)),
            path: file.path,
            sizeBytes: file.size,
            format: ext === "sql" ? "plain" : "archive",
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return { databases };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read archive contents";
      if (/does not exist|not found|no archive/i.test(message)) {
        await pool.query(`DELETE FROM archives WHERE project_id = $1 AND name = $2`, [
          project.id,
          name,
        ]);
        return sendError(
          reply,
          404,
          "Archive is no longer in the Borg repository. Refresh the archive list and choose another archive.",
        );
      }
      return sendError(reply, 500, message);
    }
  });

  app.delete("/api/projects/:id/archives/:name", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const name = archiveName(request);
    try {
      await deleteArchive(project, name);
      invalidateRepoSize(project);
      await pool.query(`DELETE FROM archives WHERE project_id = $1 AND name = $2`, [
        project.id,
        name,
      ]);
      await audit(getActor(request), "archive.delete", `${project.slug}/${name}`);
      return { ok: true };
    } catch (error) {
      return sendError(reply, 500, error instanceof Error ? error.message : "Delete failed");
    }
  });

  app.post("/api/projects/:id/archives/:name/verify", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const name = archiveName(request);
    const lines: string[] = [];
    try {
      await checkArchive(project, name, (line) => lines.push(line));
      await pool.query(
        `UPDATE archives SET verified_at = now() WHERE project_id = $1 AND name = $2`,
        [project.id, name],
      );
      await audit(getActor(request), "archive.verify", `${project.slug}/${name}`);
      return { ok: true, output: lines.join("\n") };
    } catch (error) {
      return sendError(reply, 500, error instanceof Error ? error.message : "Verify failed");
    }
  });

  app.post("/api/projects/:id/restore", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const body = z
      .object({
        archive: z.string().min(1),
        database: z.string().min(1),
        memberPath: z.string().optional(),
        targetDatabase: z.string().regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores"),
        overwrite: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return sendError(reply, 400, body.error.issues[0]?.message || "Invalid body");
    const memberPath = body.data.memberPath || safeDbFile(body.data.database);
    if (!memberPath.startsWith("databases/") || memberPath.includes("..")) {
      return sendError(reply, 400, "Invalid archive member path");
    }
    const server = await getServer(project.server_id);
    if (!server) return sendError(reply, 404, "Docker server not found");

    const lines: string[] = [];
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: Record<string, unknown>) => {
      try {
        reply.raw.write(`${JSON.stringify(event)}\n`);
      } catch {
        /* client disconnected */
      }
    };
    const progress = (percent: number, label: string) =>
      send({ type: "progress", percent, label });

    try {
      progress(5, "Resolving container…");
      const { container, changed, previous } = await resolveProjectContainer(project, server);
      if (changed) {
        send({
          type: "log",
          message: `Re-linked container: ${previous.name || previous.id || "unknown"} -> ${container.name} (${container.id.slice(0, 12)})`,
        });
      }
      if (container.state !== "running") {
        throw new Error(`Container ${container.name} is not running`);
      }
      progress(15, "Preparing target database…");

      const log = (line: string) => {
        lines.push(line);
        let percent: number | null = null;
        let label = "";
        if (/Terminating connections/i.test(line)) {
          percent = 20;
          label = "Preparing target database…";
        } else if (/Dropping database/i.test(line)) {
          percent = 24;
          label = "Preparing target database…";
        } else if (/Creating database/i.test(line)) {
          percent = 28;
          label = "Creating target database…";
        } else if (/Extracting/i.test(line)) {
          percent = 38;
          label = "Extracting dump from Borg…";
        } else if (/Copying dump/i.test(line)) {
          percent = 55;
          label = "Copying dump into container…";
        } else if (/Restoring into|Applying SQL dump/i.test(line)) {
          percent = 70;
          label = "Restoring database objects…";
        }
        if (percent !== null) progress(percent, label);
        send({ type: "log", message: line });
      };

      await restoreDatabase(
        project,
        server,
        container.id,
        body.data.archive,
        memberPath,
        body.data.targetDatabase,
        Boolean(body.data.overwrite),
        log,
      );
      progress(100, "Restore complete");
      send({ type: "done", output: lines.join("\n") });
      await audit(getActor(request), "archive.restore", `${project.slug}/${body.data.archive}`, {
        targetDatabase: body.data.targetDatabase,
        overwrite: body.data.overwrite,
        container: container.name,
      }).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Restore failed";
      send({ type: "error", error: message, output: lines.join("\n") });
      await audit(getActor(request), "archive.restore.failed", `${project.slug}/${body.data.archive}`, {
        targetDatabase: body.data.targetDatabase,
        error: message,
      }).catch(() => {});
    } finally {
      reply.raw.end();
    }
    return reply;
  });

  app.get("/api/projects/:id/archives/:name/export", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const name = archiveName(request);
    const child = exportArchiveStream(project, name);
    reply.header("Content-Type", "application/x-tar");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${project.slug}-${name}.tar"`,
    );
    child.stderr.on("data", (c: Buffer) => app.log.warn(c.toString()));
    child.on("error", () => {
      if (!reply.sent) reply.code(500).send({ error: "Export failed" });
    });
    return reply.send(child.stdout);
  });

  app.get("/api/projects/:id/export", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const root = projectBackupDir(project);
    if (!fs.existsSync(root)) return sendError(reply, 404, "No repository on disk for this project");
    const child = exportRepoStream(project);
    reply.header("Content-Type", "application/x-tar");
    reply.header("Content-Disposition", `attachment; filename="${project.slug}-borg-repo.tar"`);
    child.stderr.on("data", (c: Buffer) => app.log.warn(c.toString()));
    return reply.send(child.stdout);
  });

  // ---------- Export / import ----------
  app.get("/api/export/catalog", async (request, reply) => {
    const projects = await getProjects();
    const archives = await pool.query(
      `SELECT project_id, name, created_at, original_size, deduplicated_size, size_bytes, file_count
       FROM archives ORDER BY created_at DESC`,
    );
    const catalog = {
      format: "delta-postgres-catalog-v1",
      exportedAt: new Date().toISOString(),
      appVersion: config.appVersion,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        source: p.source,
        enabled: p.enabled,
        container: p.container_name,
        image: p.container_image,
        composeProject: p.compose_project,
        pgUser: p.pg_user,
        databases: p.databases,
        scheduleCron: p.schedule_cron,
        retention: {
          daily: p.keep_daily,
          weekly: p.keep_weekly,
          monthly: p.keep_monthly,
        },
        compression: p.compression,
        notes: p.notes,
      })),
      archives: archives.rows,
    };
    reply.header("Content-Type", "application/json");
    reply.header("Content-Disposition", "attachment; filename=\"delta-postgres-catalog.json\"");
    await audit(getActor(request), "export.catalog");
    return catalog;
  });

  app.get("/api/export/all", async (request, reply) => {
    // Keep a small catalog alongside the repositories.
    try {
      const projects = await getProjects();
      fs.writeFileSync(
        path.join(config.backupRoot, "_catalog.json"),
        JSON.stringify(
          {
            format: "delta-postgres-catalog-v1",
            exportedAt: new Date().toISOString(),
            projects: projects.map((p) => ({
              name: p.name,
              slug: p.slug,
              container: p.container_name,
              image: p.container_image,
              pgUser: p.pg_user,
              databases: p.databases,
              scheduleCron: p.schedule_cron,
            })),
          },
          null,
          2,
        ),
      );
    } catch {
      /* best effort */
    }
    const child = exportAllStream();
    reply.header("Content-Type", "application/x-tar");
    reply.header("Content-Disposition", "attachment; filename=\"delta-postgres-all-repos.tar\"");
    child.stderr.on("data", (c: Buffer) => app.log.warn(c.toString()));
    await audit(getActor(request), "export.all");
    return reply.send(child.stdout);
  });

  app.post("/api/import", async (request, reply) => {
    const data = await request.file();
    if (!data) return sendError(reply, 400, "A tar file is required");
    const fields = data.fields as Record<string, any>;
    const fieldValue = (name: string): string | undefined => {
      const field = fields?.[name];
      if (!field) return undefined;
      if (Array.isArray(field)) return field[0]?.value;
      return field.value;
    };
    const projectIdValue = fieldValue("projectId");
    const mode = fieldValue("mode") || "archive";
    const rawArchiveName = fieldValue("archiveName");
    const archiveNameValue = rawArchiveName
      ?.replace(/\.(tar|tgz|tar\.gz)$/i, "")
      .trim();
    const parsedProjectId = Number(projectIdValue);
    if (!projectIdValue || !Number.isFinite(parsedProjectId)) {
      data.file.resume();
      return sendError(reply, 400, "A valid projectId is required");
    }
    const project = await getProject(parsedProjectId);
    if (!project) {
      // Drain and discard the upload on validation failure.
      data.file.resume();
      return sendError(reply, 400, "A valid projectId is required");
    }
    if (mode === "archive" && !archiveNameValue) {
      data.file.resume();
      return sendError(reply, 400, "archiveName is required for archive import");
    }
    if (archiveNameValue && (archiveNameValue.includes("/") || archiveNameValue.includes(".."))) {
      data.file.resume();
      return sendError(reply, 400, "archiveName cannot contain slashes or '..'");
    }

    ensureDir(config.stagingRoot);
    const tempFile = path.join(
      config.stagingRoot,
      `import-${Date.now()}-${(data.filename || "upload.tar").replace(/[^a-zA-Z0-9_.-]/g, "_")}`,
    );
    try {
      await pipeline(data.file, fs.createWriteStream(tempFile));
      const lines: string[] = [];
      const log = (line: string) => lines.push(line);

      if (mode === "archive") {
        await importArchiveFromFile(project, archiveNameValue!, tempFile, log);
        await syncProjectArchives(project);
      } else {
        const tempDir = path.join(config.stagingRoot, `extract-${Date.now()}`);
        ensureDir(tempDir);
        const list = await runCommand("tar", ["-tf", tempFile], { maxBuffer: 32 * 1024 * 1024 });
        if (list.code !== 0) throw new Error(list.stderr || "Invalid tar archive");
        const entries = list.stdout.split("\n").filter(Boolean);
        if (entries.some((e) => e.startsWith("/") || e.split("/").includes(".."))) {
          throw new Error("Refusing to import an archive with unsafe paths");
        }
        const extract = await runCommand("tar", ["-xf", tempFile, "-C", tempDir, "--no-same-owner"]);
        if (extract.code !== 0) throw new Error(extract.stderr || "Extraction failed");

        const candidates = [
          path.join(tempDir, project.slug, "repo"),
          path.join(tempDir, "repo"),
          path.join(tempDir, "config") ? tempDir : "",
        ];
        let sourceRepo = candidates.find((p) => p && fs.existsSync(path.join(p, "config")));
        if (!sourceRepo) {
          const first = fs.readdirSync(tempDir)[0];
          if (first) {
            const nested = path.join(tempDir, first, "repo");
            if (fs.existsSync(path.join(nested, "config"))) sourceRepo = nested;
          }
        }
        if (!sourceRepo) throw new Error("Uploaded archive does not contain a Borg repository");
        const targetDir = projectBackupDir(project);
        ensureDir(targetDir);
        rmrf(path.join(targetDir, "repo"));
        // Clear per-project Borg cache/security metadata; the imported repository may
        // have been copied from another location or project.
        rmrf(path.join(config.dataDir, "borg", project.slug));
        fs.cpSync(sourceRepo, path.join(targetDir, "repo"), { recursive: true });
        rmrf(tempDir);
        await syncProjectArchives(project);
      }
      invalidateRepoSize(project);
      await audit(getActor(request), "import", project.slug, { mode, archive: archiveNameValue });
      return { ok: true, output: lines.join("\n") };
    } catch (error) {
      return sendError(reply, 500, error instanceof Error ? error.message : "Import failed");
    } finally {
      try {
        fs.rmSync(tempFile, { force: true });
      } catch {
        /* ignore */
      }
    }
  });

  app.post("/api/projects/:id/import-dump", async (request, reply) => {
    const project = await requireProject(request, reply);
    if (!project) return;
    const data = await request.file();
    if (!data) return sendError(reply, 400, "A PostgreSQL dump file is required");
    const fields = data.fields as Record<string, any>;
    const fieldValue = (name: string): string | undefined => {
      const field = fields?.[name];
      if (!field) return undefined;
      if (Array.isArray(field)) return field[0]?.value;
      return field.value;
    };
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rawName = fieldValue("archiveName");
    const baseName =
      (rawName || `imported-${timestamp}`)
        .replace(/\.(tar|tgz|tar\.gz|sql|dump|backup)$/i, "")
        .trim() || `imported-${timestamp}`;
    if (baseName.includes("/") || baseName.includes("..")) {
      data.file.resume();
      return sendError(reply, 400, "archiveName cannot contain slashes or '..'");
    }

    ensureDir(config.stagingRoot);
    const tempFile = path.join(
      config.stagingRoot,
      `dump-upload-${Date.now()}-${(data.filename || "dump").replace(/[^a-zA-Z0-9_.-]/g, "_")}`,
    );
    const staging = path.join(config.stagingRoot, `import-dump-${Date.now()}`);
    try {
      await pipeline(data.file, fs.createWriteStream(tempFile));
      const sizeBytes = fileSize(tempFile);
      if (!sizeBytes) throw new Error("Uploaded dump file is empty");

      const originalName = (data.filename || "").toLowerCase();
      let ext = "dump";
      let format: "plain" | "custom" | "tar" = "custom";
      if (originalName.endsWith(".sql")) {
        ext = "sql";
        format = "plain";
      } else if (originalName.endsWith(".tar")) {
        ext = "tar";
        format = "tar";
      } else {
        const fd = fs.openSync(tempFile, "r");
        const header = Buffer.alloc(5);
        const read = fs.readSync(fd, header, 0, 5, 0);
        fs.closeSync(fd);
        if (read === 5 && header.toString("utf8") === "PGDMP") {
          ext = "dump";
          format = "custom";
        } else if (originalName.endsWith(".dump") || originalName.endsWith(".backup")) {
          ext = "dump";
          format = "custom";
        } else {
          ext = "sql";
          format = "plain";
        }
      }

      const database = project.pg_default_db || "database";
      const safeDb = database.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const memberPath = `databases/${safeDb}.${ext}`;
      ensureDir(path.join(staging, "databases"));
      fs.copyFileSync(tempFile, path.join(staging, memberPath));
      const sha256 = await hashFile(path.join(staging, memberPath));

      fs.writeFileSync(
        path.join(staging, "manifest.json"),
        JSON.stringify(
          {
            format: "delta-postgres-v1",
            appVersion: config.appVersion,
            source: "raw-dump-import",
            project: { id: project.id, name: project.name, slug: project.slug },
            database,
            sourceFormat: format,
            databases: [
              {
                name: database,
                file: memberPath,
                sizeBytes,
                sha256,
              },
            ],
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      const existing = new Set((await listArchives(project)).map((archive) => archive.name));
      let archiveName = baseName;
      let suffix = 1;
      while (existing.has(archiveName)) {
        archiveName = `${baseName}-${suffix++}`;
      }

      const logLines: string[] = [];
      const stats = await createArchive(project, staging, archiveName, (line) =>
        logLines.push(line),
      );
      await pool.query(
        `INSERT INTO archives(project_id, job_id, name, created_at, size_bytes,
           original_size, deduplicated_size, file_count)
         VALUES($1, NULL, $2, now(), $3, $4, $5, $6)`,
        [
          project.id,
          archiveName,
          stats.compressedSize,
          stats.originalSize,
          stats.deduplicatedSize,
          stats.fileCount,
        ],
      );
      invalidateRepoSize(project);
      await audit(getActor(request), "import.dump", project.slug, {
        archiveName,
        database,
        format,
        sizeBytes,
      });
      return {
        ok: true,
        archive: {
          name: archiveName,
          database,
          memberPath,
          format,
          sizeBytes,
        },
        output: logLines.join("\n"),
      };
    } catch (error) {
      return sendError(
        reply,
        500,
        error instanceof Error ? error.message : "Dump import failed",
      );
    } finally {
      rmrf(staging);
      try {
        fs.rmSync(tempFile, { force: true });
      } catch {
        /* ignore */
      }
    }
  });

  // ---------- Settings ----------
  app.get("/api/settings", async () => {
    const stored = await getSettings();
    return {
      settings: {
        globalCron: stored.globalCron ?? config.defaultCron,
        keepDaily: stored.keepDaily ?? config.keepDaily,
        keepWeekly: stored.keepWeekly ?? config.keepWeekly,
        keepMonthly: stored.keepMonthly ?? config.keepMonthly,
        notificationWebhook: stored.notificationWebhook ?? "",
        autoAddProjects: stored.autoAddProjects !== false,
        timezone: String(stored.timezone || config.timezone),
        concurrency: Number(stored.concurrency || config.concurrency),
        appVersion: config.appVersion,
        borgVersion: await borgVersion(),
        dockerSocket: config.dockerSocket,
        backupRoot: config.backupRoot,
      },
    };
  });

  app.patch("/api/settings", async (request, reply) => {
    const schema = z.object({
      globalCron: z.string().optional(),
      keepDaily: z.number().int().min(0).optional(),
      keepWeekly: z.number().int().min(0).optional(),
      keepMonthly: z.number().int().min(0).optional(),
      notificationWebhook: z.string().optional(),
      autoAddProjects: z.boolean().optional(),
      timezone: z.string().optional(),
      concurrency: z.number().int().min(1).max(10).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || "Invalid body");
    if (parsed.data.timezone && !isValidTimezone(parsed.data.timezone)) {
      return sendError(reply, 400, "Invalid timezone");
    }
    const stored = await getSettings();
    const timezone = String(parsed.data.timezone || stored.timezone || config.timezone);
    if (
      parsed.data.globalCron &&
      computeNextRun(parsed.data.globalCron, new Date(), timezone) === null
    ) {
      return sendError(reply, 400, "Invalid cron expression");
    }
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) await setSetting(key, value);
    }
    if (parsed.data.timezone) {
      process.env.TZ = parsed.data.timezone;
    }
    if (parsed.data.globalCron || parsed.data.timezone) {
      await recomputeAllSchedules(true);
    }
    await audit(getActor(request), "settings.update", undefined, parsed.data);
    return { ok: true };
  });

  app.get("/api/audit", async (request) => {
    const query = request.query as any;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(query.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const total = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_log`,
    );
    const totalCount = Number(total.rows[0]?.count || 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const safePage = Math.min(page, totalPages);
    const safeOffset = (safePage - 1) * pageSize;
    const { rows } = await pool.query(
      `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, safeOffset],
    );
    return {
      audit: rows,
      pagination: {
        page: safePage,
        pageSize,
        total: totalCount,
        totalPages,
      },
    };
  });
}
