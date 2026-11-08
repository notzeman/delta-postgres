import crypto from "crypto";
import { config } from "./config";

const key = crypto.createHash("sha256").update(config.secretsKey).digest();

/**
 * Encrypt small secrets (Docker TLS keys/certs) before storing them in Postgres.
 * Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
export function encryptSecret(value?: string | null): string | null {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(value?: string | null): string | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    // Allow legacy plaintext values.
    return value;
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
