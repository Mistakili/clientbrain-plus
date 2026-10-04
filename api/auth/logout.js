import { readCookie, SESSION_COOKIE, sessionCookie } from "../_lib/auth.js";
import { deleteSession } from "../_lib/db.js";
import { guard, send } from "../_lib/http.js";

async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  await deleteSession(readCookie(req, SESSION_COOKIE));
  return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", req, { clear: true }) });
}

export default guard(handler);
