import { readCookie, secretConfigured, secretMatches, SESSION_COOKIE, suppliedOwnerId, suppliedSecret } from "./auth.js";
import { ownerById, ownerFromToken } from "./db.js";
import { send } from "./http.js";

export async function requireOwner(req, res) {
  if (!secretConfigured()) {
    send(res, 500, { ok: false, error: "CLIENTBRAIN_TOOL_SECRET must be at least 16 characters" });
    return null;
  }
  const sessionOwner = await ownerFromToken(readCookie(req, SESSION_COOKIE));
  if (sessionOwner) return sessionOwner;
  if (!secretMatches(suppliedSecret(req))) {
    send(res, 401, { ok: false, error: "Unauthorized" });
    return null;
  }
  const owner = await ownerById(suppliedOwnerId(req));
  if (!owner) {
    send(res, 401, { ok: false, error: "Unauthorized" });
    return null;
  }
  return owner;
}
