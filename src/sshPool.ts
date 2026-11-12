import http from "http";
import crypto from "crypto";
import util from "util";
import type { Duplex } from "stream";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";

/**
 * Persistent SSH transport for remote Docker servers.
 *
 * dockerode's built-in SSH transport performs a full SSH handshake and login
 * (and spawns `docker system dial-stdio` on the remote host) for every single
 * Docker API request. This module keeps ONE authenticated SSH connection per
 * server and opens a lightweight channel per request instead.
 *
 * Channels go straight to the remote Docker socket via OpenSSH stream-local
 * forwarding, so no process is started on the remote host. If the server
 * forbids stream-local forwarding, we fall back to `docker system dial-stdio`
 * over the same connection.
 */

// Stay below OpenSSH's default MaxSessions (10) per connection.
const MAX_CHANNELS = 8;
const DEFAULT_REMOTE_SOCKET = "/var/run/docker.sock";
const DIAL_STDIO_COMMAND = "docker system dial-stdio";
// Outdated connections (server credentials changed) are closed once idle this long.
const STALE_IDLE_MS = 60_000;

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  password?: string;
  socketPath?: string | null;
  /** Pinned host key ("<type> SHA256:<hash>"); null/undefined = trust on first use. */
  hostKey?: string | null;
  /** Called once when a host key is trusted on first use, to persist it. */
  onHostKeyTrusted?: (hostKey: string) => void;
}

/** OpenSSH-style fingerprint of a raw SSH public key blob. */
export function hostKeyFingerprint(key: Buffer): string {
  let type = "unknown";
  try {
    const length = key.readUInt32BE(0);
    type = key.subarray(4, 4 + length).toString("ascii");
  } catch {
    /* keep "unknown" */
  }
  const hash = crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return `${type} SHA256:${hash}`;
}

function fingerprintOf(target: SshTarget): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        target.host,
        target.port,
        target.username,
        target.password || "",
        target.socketPath || "",
      ]),
    )
    .digest("hex");
}

class SshConnection {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private active = 0;
  private waiters: Array<() => void> = [];
  private mode: "streamlocal" | "dial-stdio" = "streamlocal";
  private closed = false;
  private lastUsed = Date.now();
  // Host key we require (pinned), and the one the server last presented.
  private expectedHostKey: string | null;
  private presentedHostKey: string | null = null;
  readonly agent: http.Agent;

  constructor(
    readonly key: string,
    readonly fingerprint: string,
    private readonly target: SshTarget,
  ) {
    const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
    // Node's Agent supports an async createConnection via the callback.
    (agent as any).createConnection = (
      _options: unknown,
      callback: (err: Error | null, stream?: Duplex) => void,
    ) => {
      this.openChannel().then(
        (stream) => callback(null, stream),
        (error) => callback(error instanceof Error ? error : new Error(String(error))),
      );
      return undefined;
    };
    // docker-modem eagerly runs util.inspect(options, { showHidden, depth: null })
    // on every request for a debug line, even when debugging is off. A shared
    // agent references every live SSH channel, so without this the cost grows
    // with each concurrent request and the event loop pegs at 100% CPU.
    (agent as any)[util.inspect.custom] = () => "[SshDockerAgent]";
    this.agent = agent;
    this.expectedHostKey = target.hostKey || null;
  }

  get hostKey(): string | null {
    return this.presentedHostKey || this.expectedHostKey;
  }

  /** Adopt a key pinned elsewhere (e.g. stored by a connection test). */
  expectHostKey(hostKey: string | null | undefined): void {
    if (hostKey && !this.expectedHostKey) this.expectedHostKey = hostKey;
  }

  private connect(): Promise<Client> {
    if (this.closed) return Promise.reject(new Error("SSH connection was closed"));
    if (this.client) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;

    const config: ConnectConfig = {
      host: this.target.host,
      port: this.target.port,
      username: this.target.username,
      password: this.target.password,
      readyTimeout: 20_000,
      // Refuse to talk to a host whose key changed: that is what a
      // man-in-the-middle looks like, and it would receive our password.
      hostVerifier: (key: Buffer) => {
        const presented = hostKeyFingerprint(key);
        this.presentedHostKey = presented;
        return !this.expectedHostKey || this.expectedHostKey === presented;
      },
      // Detect dead connections (network drop, host reboot) within ~45s.
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
    };

    this.connecting = new Promise<Client>((resolve, reject) => {
      const client = new Client();
      let ready = false;
      client.once("ready", () => {
        ready = true;
        this.connecting = null;
        if (!this.expectedHostKey && this.presentedHostKey) {
          this.expectedHostKey = this.presentedHostKey;
          try {
            this.target.onHostKeyTrusted?.(this.presentedHostKey);
          } catch {
            /* persisting is best effort; the key stays pinned in memory */
          }
        }
        // Docker API traffic is many small request/response messages; without
        // TCP_NODELAY each one can stall ~40ms on Nagle + delayed ACK.
        client.setNoDelay(true);
        if (this.closed) {
          client.end();
          reject(new Error("SSH connection was closed"));
          return;
        }
        this.client = client;
        resolve(client);
      });
      // An 'error' listener must always exist, or ssh2 errors crash the process.
      client.on("error", (error) => {
        if (!ready) {
          this.connecting = null;
          const mismatch =
            this.expectedHostKey &&
            this.presentedHostKey &&
            this.expectedHostKey !== this.presentedHostKey;
          reject(
            mismatch
              ? new Error(
                  `SSH host key for ${this.target.host} changed (expected ${this.expectedHostKey}, ` +
                    `got ${this.presentedHostKey}). Connection refused for safety. If the server ` +
                    `was reinstalled, verify the new key and use "Reset host key" in server settings.`,
                )
              : error,
          );
        }
      });
      client.on("close", () => {
        // The next request transparently reconnects.
        if (this.client === client) this.client = null;
        if (!ready) {
          this.connecting = null;
          reject(new Error("SSH connection closed before it was ready"));
        }
      });
      client.connect(config);
    });
    return this.connecting;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Milliseconds with no open channel, or 0 while in use. */
  idleFor(): number {
    return this.active > 0 || this.waiters.length > 0 ? 0 : Date.now() - this.lastUsed;
  }

  private acquire(): Promise<void> {
    this.lastUsed = Date.now();
    if (this.active < MAX_CHANNELS) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    this.lastUsed = Date.now();
    const next = this.waiters.shift();
    if (next) next();
  }

  private streamLocal(client: Client): Promise<ClientChannel> {
    const socketPath = this.target.socketPath || DEFAULT_REMOTE_SOCKET;
    return new Promise((resolve, reject) => {
      client.openssh_forwardOutStreamLocal(socketPath, (error, stream) =>
        error ? reject(error) : resolve(stream),
      );
    });
  }

  private dialStdio(client: Client): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      client.exec(DIAL_STDIO_COMMAND, (error, stream) => {
        if (error) return reject(error);
        // Drain stderr so a chatty remote CLI can never stall the channel.
        stream.stderr.resume();
        resolve(stream);
      });
    });
  }

  private async open(client: Client): Promise<ClientChannel> {
    if (this.mode === "streamlocal") {
      try {
        return await this.streamLocal(client);
      } catch (error) {
        // A channel open failure means the server refused stream-local
        // forwarding (or the socket path differs); the connection itself is
        // fine, so switch to dial-stdio for this server from now on.
        if ((error as any)?.reason === undefined || this.client !== client) throw error;
        this.mode = "dial-stdio";
      }
    }
    return this.dialStdio(client);
  }

  async openChannel(): Promise<Duplex> {
    await this.acquire();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.release();
    };
    try {
      const client = await this.connect();
      const stream = await this.open(client);
      stream.once("close", release);
      // ssh2 only emits 'close' once the remote acknowledges our CHANNEL_CLOSE.
      // If the HTTP layer destroys a channel mid-stream it stops reading, the
      // flow-control window never reopens, and the remote can't finish. So keep
      // draining after a local destroy, and free the slot after a grace period
      // regardless, so an unresponsive remote can never exhaust the pool.
      const destroy = stream.destroy.bind(stream);
      (stream as any).destroy = (...args: unknown[]) => {
        stream.on("data", () => {});
        stream.resume();
        setTimeout(release, 15_000).unref();
        return destroy(...(args as []));
      };
      return stream;
    } catch (error) {
      release();
      throw error;
    }
  }

  close(): void {
    this.closed = true;
    this.client?.end();
    this.client = null;
    this.agent.destroy();
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}

// Keyed by `${key}#${fingerprint}`. A server normally has exactly one entry.
const connections = new Map<string, SshConnection>();
// Most recently requested fingerprint per server key.
const latest = new Map<string, string>();
let reaper: NodeJS.Timeout | null = null;

function reapStale(): void {
  for (const [id, connection] of connections) {
    const outdated = latest.get(connection.key) !== connection.fingerprint;
    if (connection.isClosed || (outdated && connection.idleFor() > STALE_IDLE_MS)) {
      connection.close();
      connections.delete(id);
    }
  }
  if (connections.size === 0 && reaper) {
    clearInterval(reaper);
    reaper = null;
  }
}

/**
 * Return the shared http.Agent for an SSH Docker server. The same server and
 * credentials always reuse one long-lived SSH connection (it reconnects on its
 * own if dropped). When credentials change, the old connection is never cut
 * off mid-request: in-flight work such as a running pg_dump finishes on it, and
 * it is closed only after it has been idle for STALE_IDLE_MS.
 */
export function sshAgentFor(key: string, target: SshTarget): http.Agent {
  const fingerprint = fingerprintOf(target);
  latest.set(key, fingerprint);
  const id = `${key}#${fingerprint}`;
  let connection = connections.get(id);
  if (connection && !connection.isClosed) {
    connection.expectHostKey(target.hostKey);
  } else {
    connection = new SshConnection(key, fingerprint, target);
    connections.set(id, connection);
    if (!reaper) {
      reaper = setInterval(reapStale, 30_000);
      reaper.unref();
    }
  }
  return connection.agent;
}

/** Host key presented by (or pinned for) the current connection of a server key. */
export function sshHostKeyOf(key: string): string | null {
  const fingerprint = latest.get(key);
  return fingerprint ? connections.get(`${key}#${fingerprint}`)?.hostKey ?? null : null;
}

/** Close every connection for a server key (server deleted, test finished). */
export function closeSshConnection(key: string): void {
  for (const [id, connection] of connections) {
    if (connection.key !== key) continue;
    connection.close();
    connections.delete(id);
  }
  latest.delete(key);
}

export function closeAllSshConnections(): void {
  for (const connection of connections.values()) connection.close();
  connections.clear();
  latest.clear();
  if (reaper) clearInterval(reaper);
  reaper = null;
}

/** Pool key for an unsaved server (connection test before saving). */
export function temporarySshKey(target: SshTarget): string {
  return `temp:${fingerprintOf(target)}`;
}
