import { ensureAgent } from "./_lib/agents.js";
import { readCookie, secretConfigured, SESSION_COOKIE } from "./_lib/auth.js";
import { ownerFromToken } from "./_lib/db.js";
import { guard, send } from "./_lib/http.js";
import { appBaseFromRequest, originMatchesApp } from "./_lib/voice.js";

async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const origin = req.headers.origin || "";
  const allowed = String(process.env.ALLOWED_ORIGIN || "").split(",").map((item) => item.trim()).filter(Boolean);
  const isLocal = origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
  if (allowed.length && origin && !allowed.includes(origin) && !isLocal) return send(res, 403, { error: "Forbidden" });
  if (!secretConfigured()) return send(res, 500, { error: "CLIENTBRAIN_TOOL_SECRET must be at least 16 characters" });
  const owner = await ownerFromToken(readCookie(req, SESSION_COOKIE));
  if (!owner) return send(res, 401, { error: "Sign in required" });
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return send(res, 500, { error: "ASSEMBLYAI_API_KEY is not configured" });
  const base = appBaseFromRequest(req);
  if (!base || !originMatchesApp(req, base)) return send(res, 400, { error: "Could not determine app origin" });
  try {
    const url = new URL("https://agents.assemblyai.com/v1/token");
    url.searchParams.set("expires_in_seconds", "300");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    const data = await response.json();
    if (!response.ok) return send(res, response.status, { error: data?.error || "Voice token request failed" });
    let agentId = null;
    try {
      const agent = await ensureAgent({ ownerId: owner.id, base, secret: process.env.CLIENTBRAIN_TOOL_SECRET });
      agentId = agent.agent_id || null;
    } catch {
      agentId = null;
    }
    return send(res, 200, { token: data.token, agent_id: agentId });
  } catch {
    return send(res, 500, { error: "Token service failed" });
  }
}

export default guard(handler);
