import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { config } from "../config.js";

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LoginSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(512),
  })
  .strict();

type AdminSession = {
  sub: string;
  iat: number;
  exp: number;
};

function getAdminConfiguration():
  | { username: string; password: string; sessionSecret: string }
  | undefined {
  const { ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SESSION_SECRET } = config;
  if (
    !ADMIN_USERNAME ||
    !ADMIN_PASSWORD ||
    !ADMIN_SESSION_SECRET ||
    ADMIN_SESSION_SECRET.length < 32
  ) {
    return undefined;
  }
  return {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
    sessionSecret: ADMIN_SESSION_SECRET,
  };
}

function fixedTimeStringEquals(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createToken(username: string, secret: string): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const session: AdminSession = {
    sub: username,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return {
    token: `${payload}.${sign(payload, secret)}`,
    expiresAt: new Date(session.exp * 1000).toISOString(),
  };
}

function isValidToken(token: string, username: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }

  const [payload, signature] = parts;
  if (!fixedTimeStringEquals(signature, sign(payload, secret))) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("sub" in parsed) ||
      !("iat" in parsed) ||
      !("exp" in parsed) ||
      typeof parsed.sub !== "string" ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    return (
      fixedTimeStringEquals(parsed.sub, username) &&
      parsed.exp > now &&
      parsed.iat <= now + 60 &&
      parsed.exp - parsed.iat <= SESSION_TTL_SECONDS
    );
  } catch {
    return false;
  }
}

export function createAdminSession(request: Request, response: Response): void {
  const admin = getAdminConfiguration();
  if (!admin) {
    response.status(503).json({
      error:
        "Admin access is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD, and an ADMIN_SESSION_SECRET of at least 32 characters.",
    });
    return;
  }

  const parsed = LoginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Enter a valid admin username and password." });
    return;
  }

  if (
    !fixedTimeStringEquals(parsed.data.username, admin.username) ||
    !fixedTimeStringEquals(parsed.data.password, admin.password)
  ) {
    response.status(401).json({ error: "Invalid admin credentials." });
    return;
  }

  response.json(createToken(admin.username, admin.sessionSecret));
}

export function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  const admin = getAdminConfiguration();
  if (!admin) {
    response.status(503).json({ error: "Admin access is not configured on the backend." });
    return;
  }

  const authorization = request.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || !isValidToken(token, admin.username, admin.sessionSecret)) {
    response.status(401).json({ error: "Admin authentication is required." });
    return;
  }

  next();
}
