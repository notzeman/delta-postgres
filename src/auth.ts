import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config";

const COOKIE_NAME = "dp_session";
const JWT_ISSUER = "delta-postgres";

export interface SessionUser {
  username: string;
}

export function signSession(username: string): string {
  return jwt.sign({ sub: username }, config.sessionSecret, {
    expiresIn: "7d",
    issuer: JWT_ISSUER,
  });
}

export function verifySession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.sessionSecret, {
      issuer: JWT_ISSUER,
    }) as jwt.JwtPayload;
    if (!payload.sub) return null;
    return { username: String(payload.sub) };
  } catch {
    return null;
  }
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  if (username !== config.adminUsername) return false;
  if (config.adminPasswordHash) {
    return bcrypt.compare(password, config.adminPasswordHash);
  }
  if (!config.adminPassword) {
    // Development fallback: admin / admin
    return username === "admin" && password === "admin";
  }
  const a = Buffer.from(password);
  const b = Buffer.from(config.adminPassword);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export function currentUser(request: FastifyRequest): SessionUser | null {
  return verifySession(request.cookies?.[COOKIE_NAME]);
}

// Simple in-memory login rate limiter.
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRate(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 8) return false;
  entry.count += 1;
  return true;
}

export function resetLoginRate(ip: string): void {
  attempts.delete(ip);
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = currentUser(request);
  if (!user) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export function getActor(request: FastifyRequest): string {
  return currentUser(request)?.username || "system";
}
