import Docker from "dockerode";
import { config } from "./config";
import { pool, type ServerRow } from "./db";
import { decryptSecret } from "./secrets";
import {
  closeSshConnection,
  sshAgentFor,
  sshHostKeyOf,
  temporarySshKey,
  type SshTarget,
} from "./sshPool";

export type { ServerRow };

export interface ServerStatus {
  online: boolean;
  version?: string;
  apiVersion?: string;
  error?: string;
  /** SSH host key fingerprint the server presented (SSH servers only). */
  hostKey?: string | null;
}

export interface ServerPublic
  extends Omit<ServerRow, "tls_ca" | "tls_cert" | "tls_key" | "ssh_password"> {
  hasCa: boolean;
  hasCert: boolean;
  hasKey: boolean;
  hasSshPassword: boolean;
}

export function toPublicServer(server: ServerRow): ServerPublic {
  const { tls_ca, tls_cert, tls_key, ssh_password, ...rest } = server;
  return {
    ...rest,
    hasCa: Boolean(tls_ca),
    hasCert: Boolean(tls_cert),
    hasKey: Boolean(tls_key),
    hasSshPassword: Boolean(ssh_password),
  };
}

export function dockerOptionsFor(server?: ServerRow | null): any {
  if (!server || server.type === "local" || server.protocol === "socket") {
    return { socketPath: server?.socket_path || config.dockerSocket };
  }
  if (server.type === "ssh" || server.protocol === "ssh") {
    // All requests share one persistent SSH connection per server (see sshPool.ts).
    return {
      protocol: "http",
      host: "docker",
      port: 80,
      agent: sshAgentFor(sshPoolKey(server), sshTargetFor(server)),
    };
  }
  const options: any = {
    protocol: server.protocol,
    host: server.host || "localhost",
    port: server.port || (server.protocol === "https" ? 2376 : 2375),
  };
  const ca = decryptSecret(server.tls_ca);
  const cert = decryptSecret(server.tls_cert);
  const key = decryptSecret(server.tls_key);
  if (ca) options.ca = ca;
  if (cert) options.cert = cert;
  if (key) options.key = key;
  if (server.tls_verify === false) options.rejectUnauthorized = false;
  return options;
}

function isSshServer(server: ServerRow): boolean {
  return server.type === "ssh" || server.protocol === "ssh";
}

function sshTargetFor(server: ServerRow): SshTarget {
  return {
    host: server.host || "localhost",
    port: server.port || 22,
    username: server.ssh_username || "root",
    password: decryptSecret(server.ssh_password) || undefined,
    socketPath: server.socket_path,
    hostKey: server.ssh_host_key,
    // Trust on first use: pin the key the first time a saved server connects.
    onHostKeyTrusted: server.id
      ? (hostKey) => {
          pool
            .query(
              `UPDATE servers SET ssh_host_key = $1 WHERE id = $2 AND ssh_host_key IS NULL`,
              [hostKey, server.id],
            )
            .catch((error) => console.error(`Failed to pin SSH host key for ${server.name}`, error));
        }
      : undefined,
  };
}

function sshPoolKey(server: ServerRow): string {
  // Unsaved servers (connection tests) get a throwaway key.
  return server.id ? `server:${server.id}` : temporarySshKey(sshTargetFor(server));
}

/** Close the pooled SSH connection for a server (e.g. after it is deleted). */
export function closeServerConnection(server: ServerRow): void {
  if (isSshServer(server)) closeSshConnection(sshPoolKey(server));
}

export function dockerClient(server?: ServerRow | null): Docker {
  return new Docker(dockerOptionsFor(server));
}

export async function listServers(): Promise<ServerRow[]> {
  const { rows } = await pool.query<ServerRow>(
    `SELECT * FROM servers ORDER BY (type = 'local') DESC, name ASC`,
  );
  return rows;
}

export async function getServer(id: number): Promise<ServerRow | null> {
  const { rows } = await pool.query<ServerRow>(
    `SELECT * FROM servers WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function getLocalServer(): Promise<ServerRow> {
  const { rows } = await pool.query<ServerRow>(
    `SELECT * FROM servers WHERE slug = 'local' LIMIT 1`,
  );
  if (!rows[0]) throw new Error("Local Docker server is not initialized");
  return rows[0];
}

export async function serverStatus(
  server: ServerRow,
  timeoutMs = 5000,
): Promise<ServerStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const client = dockerClient(server);
    const version: any = await Promise.race([
      client.version(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Connection timed out")), timeoutMs);
      }),
    ]);
    return {
      online: true,
      version: version.Version,
      apiVersion: version.ApiVersion,
      hostKey: isSshServer(server) ? sshHostKeyOf(sshPoolKey(server)) : undefined,
    };
  } catch (error) {
    return {
      online: false,
      error: error instanceof Error ? error.message : String(error),
      hostKey: isSshServer(server) ? sshHostKeyOf(sshPoolKey(server)) : undefined,
    };
  } finally {
    if (timer) clearTimeout(timer);
    // Connection tests for unsaved servers must not leave a connection open.
    if (!server.id) closeServerConnection(server);
  }
}

export function serverAddress(server: ServerRow): string {
  if (server.type === "local" || server.protocol === "socket") {
    return server.socket_path || config.dockerSocket;
  }
  if (server.type === "ssh" || server.protocol === "ssh") {
    return `ssh://${server.ssh_username || "root"}@${server.host}:${server.port || 22}`;
  }
  return `${server.protocol}://${server.host}:${server.port}`;
}
