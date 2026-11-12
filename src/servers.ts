import Docker from "dockerode";
import { config } from "./config";
import { pool, type ServerRow } from "./db";
import { decryptSecret } from "./secrets";

export type { ServerRow };

export interface ServerStatus {
  online: boolean;
  version?: string;
  apiVersion?: string;
  error?: string;
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
    return {
      protocol: "ssh",
      host: server.host || "localhost",
      port: server.port || 22,
      username: server.ssh_username || "root",
      password: decryptSecret(server.ssh_password) || undefined,
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
  try {
    const client = dockerClient(server);
    const version: any = await Promise.race([
      client.version(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Connection timed out")), timeoutMs),
      ),
    ]);
    return {
      online: true,
      version: version.Version,
      apiVersion: version.ApiVersion,
    };
  } catch (error) {
    return {
      online: false,
      error: error instanceof Error ? error.message : String(error),
    };
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
