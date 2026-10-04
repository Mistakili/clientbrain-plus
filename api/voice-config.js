import { readCookie, SESSION_COOKIE } from "./_lib/auth.js";
import { ownerFromToken } from "./_lib/db.js";
import { guard, send } from "./_lib/http.js";
import { voiceSession } from "./_lib/voice.js";

async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const owner = await ownerFromToken(readCookie(req, SESSION_COOKIE));
  if (!owner) return send(res, 401, { error: "Sign in required" });
  return send(res, 200, voiceSession());
}

export default guard(handler);
