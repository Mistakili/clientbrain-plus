import { ensureAgent } from "./_lib/agents.js";
import { readCookie, secretConfigured, SESSION_COOKIE } from "./_lib/auth.js";
import { ownerFromToken } from "./_lib/db.js";
import { guard, send } from "./_lib/http.js";
import { appBaseFromRequest, originMatchesApp } from "./_lib/voice.js";

async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!secretConfigured()) return send(res, 500, { error: "CLIENTBRAIN_TOOL_SECRET must be at least 16 characters" });
  const owner = await ownerFromToken(readCookie(req, SESSION_COOKIE));
  if (!owner) return send(res, 401, { error: "Sign in required" });
  const base = appBaseFromRequest(req);
  if (!base) return send(res, 400, { error: "Could not determine app origin" });
  if (!originMatchesApp(req, base)) return send(res, 400, { error: "App origin does not match this deployment" });
  const result = await ensureAgent({ ownerId: owner.id, base, secret: process.env.CLIENTBRAIN_TOOL_SECRET });
  if (!result.agent_id) return send(res, 502, { error: result.error || "Voice agent setup failed" });
  return send(res, 200, { agent_id: result.agent_id });
}

export default guard(handler);
