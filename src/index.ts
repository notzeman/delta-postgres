import fs from "fs";
import path from "path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config, ensureRuntimeDirs } from "./config";
import { initDb, countUsers, getSettings } from "./db";
import { currentUser } from "./auth";
import { registerApi } from "./routes";
import { startJobWorker, stopJobWorker } from "./jobs";
import { startScheduler, stopScheduler } from "./scheduler";
import { runAutoDiscovery } from "./autoDiscover";
import { borgVersion } from "./borg";
import { dockerVersion } from "./docker";

async function main(): Promise<void> {
  ensureRuntimeDirs();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
    bodyLimit: 10 * 1024 * 1024,
  });

  function normalizeRequestHost(value: string): string {
    const host = value.trim().toLowerCase();
    if (!host) return "";
    if (host.startsWith("[")) {
      const end = host.indexOf("]");
      return end === -1 ? host : host.slice(1, end);
    }
    const first = host.indexOf(":");
    const last = host.lastIndexOf(":");
    if (first !== -1 && first === last) return host.slice(0, first);
    return host;
  }

  function hostIsAllowed(host: string, allowed: string[]): boolean {
    if (!host) return false;
    return allowed.some(
      (entry) =>
        entry === "*" ||
        entry === host ||
        (entry.startsWith("*.") && host.endsWith(entry.slice(1))),
    );
  }

  const allowedHosts = config.allowedHosts;
  const hostCheckEnabled = allowedHosts.length > 0 && !allowedHosts.includes("*");
  if (hostCheckEnabled) {
    app.addHook("onRequest", async (request, reply) => {
      // The container healthcheck calls loopback directly.
      if (request.url === "/api/health" || request.url.startsWith("/api/health?")) return;
      const host = normalizeRequestHost(request.headers.host || "");
      if (!hostIsAllowed(host, allowedHosts)) {
        request.log.warn({ host, allowedHosts }, "Rejected disallowed Host header");
        return reply.code(400).send({ error: `Invalid host header: ${host || "(missing)"}` });
      }
    });
  }

  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024 * 1024,
      files: 1,
    },
  });

  const webDist = path.resolve(__dirname, "../web/dist");
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: false,
      index: ["index.html"],
    });
  } else {
    app.log.warn(`Web build not found at ${webDist}; API-only mode`);
  }

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api")) return;
    if (
      request.url === "/api/health" ||
      request.url.startsWith("/api/auth/login") ||
      request.url === "/api/auth/me" ||
      request.url === "/api/auth/logout"
    ) {
      return;
    }
    const user = currentUser(request);
    if (!user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  await registerApi(app);

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api")) {
      return reply.code(404).send({ error: "Not found" });
    }
    const index = path.join(webDist, "index.html");
    if (request.method === "GET" && fs.existsSync(index)) {
      return reply.type("text/html").send(fs.createReadStream(index));
    }
    return reply.code(404).send({ error: "Not found" });
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    if (reply.sent) return;
    const message = error instanceof Error ? error.message : "Internal server error";
    reply.code(500).send({ error: message });
  });

  await initDb();
  const [userCount, settings] = await Promise.all([countUsers(), getSettings()]);
  const timezone = String(settings.timezone || config.timezone);
  const concurrency = Number(settings.concurrency || config.concurrency);
  process.env.TZ = timezone;

  const version = await borgVersion();
  let docker = "unavailable";
  try {
    const info = await dockerVersion();
    docker = `v${info.version} (API ${info.apiVersion})`;
  } catch {
    /* ignore */
  }

  app.log.info(
    {
      dataDir: config.dataDir,
      backupRoot: config.backupRoot,
      timezone,
      borg: version,
      docker,
      users: userCount,
      defaultCron: config.defaultCron,
      concurrency: concurrency,
      allowedHosts: config.allowedHosts.length ? config.allowedHosts : "*",
    },
    "DeltaPostgres starting",
  );
  if (userCount === 0) {
    app.log.warn(
      "No admin user configured. Create one with: docker compose exec dashboard npm run create-admin",
    );
  }

  startJobWorker();
  startScheduler();

  let discoveryTimer: NodeJS.Timeout | null = null;
  let discoveryRunning = false;
  const autoDiscover = () => {
    // A full scan of a large remote host can take longer than the interval.
    // Never stack discovery runs on top of each other.
    if (discoveryRunning) {
      app.log.warn("Auto-discovery still running; skipping this interval");
      return;
    }
    discoveryRunning = true;
    runAutoDiscovery()
      .then((added) => {
        if (added > 0) app.log.info({ added }, "Auto-added newly discovered projects");
      })
      .catch((error) => app.log.warn(error, "Auto-discovery failed"))
      .finally(() => {
        discoveryRunning = false;
      });
  };
  const discoveryStartup = setTimeout(autoDiscover, 2500);
  discoveryTimer = setInterval(autoDiscover, 5 * 60_000);

  await app.listen({ port: config.port, host: config.host });

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);
    stopScheduler();
    stopJobWorker();
    if (discoveryTimer) clearInterval(discoveryTimer);
    clearTimeout(discoveryStartup);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Fatal startup error", error);
  process.exit(1);
});
