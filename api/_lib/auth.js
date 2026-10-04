import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "cb_plus_session";
export const SESSION_DAYS = 30;
export const MIN_SECRET_LENGTH = 16;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(password, parts[1], 32);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function newToken() {
  return randomBytes(32).toString("hex");
}

export function tokenHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function readCookie(req, name) {
  const raw = req.headers?.cookie || "";
  for (const part of raw.split(";")) {
    const text = part.trim();
    const eq = text.indexOf("=");
    if (eq === -1) continue;
    if (text.slice(0, eq) === name) return decodeURIComponent(text.slice(eq + 1));
  }
  return "";
}

export function sessionCookie(token, req, { clear = false } = {}) {
  const proto = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const parts = [
    `${SESSION_COOKIE}=${clear ? "" : encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${clear ? 0 : SESSION_DAYS * 24 * 60 * 60}`
  ];
  if (proto === "https") parts.push("Secure");
  return parts.join("; ");
}

export function configuredSecret() {
  return String(process.env.CLIENTBRAIN_TOOL_SECRET || "");
}

export function secretConfigured() {
  return configuredSecret().length >= MIN_SECRET_LENGTH;
}

export function secretMatches(supplied) {
  const secret = configuredSecret();
  const given = String(supplied || "");
  if (secret.length < MIN_SECRET_LENGTH || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(secret), Buffer.from(given));
}

export function suppliedSecret(req) {
  return req.headers?.["x-clientbrain-tool-key"] || req.query?.tool_key || "";
}

export function suppliedOwnerId(req) {
  return String(req.headers?.["x-clientbrain-owner"] || req.query?.owner_id || "").trim();
}

export function suppliedToolName(req, body) {
  return String(body?.tool || req.headers?.["x-clientbrain-tool"] || req.query?.tool || "").trim();
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function publicUser(owner) {
  return { id: owner.id, email: owner.email, name: owner.name };
}
