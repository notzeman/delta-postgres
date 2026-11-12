import {
  containerPgInfo,
  listAllContainers,
  type ContainerInfo,
} from "./docker";
import { dockerClient, type ServerRow } from "./servers";

/**
 * Per-server cache of Docker container lists and PostgreSQL info.
 *
 * Dashboard and project pages poll every 15-20s. Without a cache, each poll
 * listed/inspected every container on the (remote, possibly production) host
 * and ran psql inside its database containers. Now:
 *  - concurrent callers share one in-flight request (single flight),
 *  - results are reused for a short TTL,
 *  - a Docker events stream invalidates entries as soon as a container is
 *    created/started/stopped/removed, so cached data stays accurate.
 *
 * Backups never use this cache: they always resolve and query live.
 */

const CONTAINERS_TTL_MS = 30_000;
const PG_INFO_TTL_MS = 2 * 60_000;
const WATCH_RETRY_MIN_MS = 5_000;
const WATCH_RETRY_MAX_MS = 60_000;

// Container lifecycle events that change what a container list shows.
// Exec events (from our own psql/pg_dump calls) are deliberately excluded.
const LIFECYCLE_EVENTS = [
  "create",
  "start",
  "restart",
  "stop",
  "die",
  "kill",
  "destroy",
  "rename",
  "pause",
  "unpause",
  "update",
];

type PgInfo = Awaited<ReturnType<typeof containerPgInfo>>;

interface Entry<T> {
  value?: T;
  at: number;
  generation: number;
  inflight?: Promise<T>;
}

const containerCache = new Map<number, Entry<ContainerInfo[]>>();
const pgInfoCache = new Map<string, Entry<PgInfo>>();

function cached<K, T>(
  map: Map<K, Entry<T>>,
  key: K,
  maxAgeMs: number,
  load: () => Promise<T>,
): Promise<T> {
  let entry = map.get(key);
  if (entry?.value !== undefined && Date.now() - entry.at < maxAgeMs) {
    return Promise.resolve(entry.value);
  }
  if (entry?.inflight) return entry.inflight;
  if (!entry) {
    entry = { at: 0, generation: 0 };
    map.set(key, entry);
  }
  const target = entry;
  const generation = target.generation;
  const promise = load().then(
    (value) => {
      target.value = value;
      // If invalidated while loading, keep the value but treat it as stale.
      target.at = target.generation === generation ? Date.now() : 0;
      target.inflight = undefined;
      return value;
    },
    (error) => {
      target.inflight = undefined;
      throw error;
    },
  );
  target.inflight = promise;
  return promise;
}

function invalidate<K>(map: Map<K, Entry<unknown>>, key: K): void {
  const entry = map.get(key);
  if (!entry) return;
  entry.at = 0;
  entry.generation += 1;
}

function pgKey(serverId: number, containerId: string, pgUser: string): string {
  return `${serverId}:${containerId}:${pgUser}`;
}

function invalidateContainer(serverId: number, containerId?: string): void {
  invalidate(containerCache, serverId);
  for (const key of pgInfoCache.keys()) {
    if (!key.startsWith(`${serverId}:`)) continue;
    if (!containerId || key.startsWith(`${serverId}:${containerId}`)) {
      invalidate(pgInfoCache, key);
    }
  }
}

// ---------- Docker events watcher ----------

interface Watcher {
  updatedAt: number;
  stopped: boolean;
  stream?: NodeJS.ReadableStream & { destroy?: () => void };
  retryTimer?: NodeJS.Timeout;
  retryMs: number;
}

const watchers = new Map<number, Watcher>();

function timeOf(value: unknown): number {
  const time = new Date(value as any).getTime();
  return Number.isFinite(time) ? time : 0;
}

function startWatch(server: ServerRow, watcher: Watcher): void {
  if (watcher.stopped) return;
  let current: unknown = null;
  // Only the stream from this attempt may trigger a retry; late events from an
  // older, already-replaced stream must not start a second watcher.
  const retry = (from: unknown) => {
    if (watcher.stopped || watcher.retryTimer || from !== current) return;
    current = undefined;
    watcher.stream = undefined;
    // Events may have been missed while disconnected.
    invalidateContainer(server.id);
    watcher.retryTimer = setTimeout(() => {
      watcher.retryTimer = undefined;
      startWatch(server, watcher);
    }, watcher.retryMs);
    watcher.retryTimer.unref();
    watcher.retryMs = Math.min(watcher.retryMs * 2, WATCH_RETRY_MAX_MS);
  };

  dockerClient(server)
    .getEvents({ filters: { type: ["container"], event: LIFECYCLE_EVENTS } as any })
    .then((stream: any) => {
      if (watcher.stopped) {
        stream.destroy?.();
        return;
      }
      watcher.stream = stream;
      current = stream;
      watcher.retryMs = WATCH_RETRY_MIN_MS;
      let buffer = "";
      stream.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            invalidateContainer(server.id, event.Actor?.ID || event.id);
          } catch {
            invalidateContainer(server.id);
          }
        }
      });
      stream.on("error", () => retry(stream));
      stream.on("end", () => retry(stream));
      stream.on("close", () => retry(stream));
    })
    .catch(() => retry(null));
}

/** Make sure a live events watcher runs for this server's current settings. */
function ensureWatcher(server: ServerRow): void {
  if (!server.id || !server.enabled) return;
  const updatedAt = timeOf(server.updated_at);
  const existing = watchers.get(server.id);
  // Only replace the watcher for newer settings (a running backup may still
  // hold an older copy of the server row).
  if (existing && updatedAt <= existing.updatedAt) return;
  if (existing) stopWatcher(existing);
  const watcher: Watcher = { updatedAt, stopped: false, retryMs: WATCH_RETRY_MIN_MS };
  watchers.set(server.id, watcher);
  startWatch(server, watcher);
}

function stopWatcher(watcher: Watcher): void {
  watcher.stopped = true;
  if (watcher.retryTimer) clearTimeout(watcher.retryTimer);
  watcher.stream?.destroy?.();
}

// ---------- Public API ----------

/**
 * Container list for a server, served from cache when fresh.
 * Pass `fresh: true` for an explicit user-requested rescan.
 */
export function cachedContainers(
  server: ServerRow,
  opts: { fresh?: boolean } = {},
): Promise<ContainerInfo[]> {
  // Unsaved servers (connection tests) are never cached.
  if (!server.id) return listAllContainers(server);
  ensureWatcher(server);
  if (opts.fresh) invalidate(containerCache, server.id);
  return cached(containerCache, server.id, CONTAINERS_TTL_MS, () => listAllContainers(server));
}

/** Database list + version for a container, served from cache when fresh. */
export function cachedPgInfo(
  server: ServerRow,
  containerId: string,
  pgUser: string,
  opts: { fresh?: boolean } = {},
): Promise<PgInfo> {
  if (!server.id) return containerPgInfo(containerId, pgUser, server);
  ensureWatcher(server);
  const key = pgKey(server.id, containerId, pgUser);
  if (opts.fresh) invalidate(pgInfoCache, key);
  return cached(pgInfoCache, key, PG_INFO_TTL_MS, () =>
    containerPgInfo(containerId, pgUser, server),
  );
}

/** Drop all cached state and the events watcher for a server. */
export function forgetServer(serverId: number): void {
  const watcher = watchers.get(serverId);
  if (watcher) stopWatcher(watcher);
  watchers.delete(serverId);
  containerCache.delete(serverId);
  for (const key of pgInfoCache.keys()) {
    if (key.startsWith(`${serverId}:`)) pgInfoCache.delete(key);
  }
}

export function stopAllWatchers(): void {
  for (const watcher of watchers.values()) stopWatcher(watcher);
  watchers.clear();
}
