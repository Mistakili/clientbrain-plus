import { normalizeEmail, publicUser, sessionCookie, validEmail } from "../_lib/auth.js";
import { authenticate, createSession } from "../_lib/db.js";
import { guard, readBody, send } from "../_lib/http.js";

async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const body = await readBody(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!validEmail(email) || !password) return send(res, 401, { error: "Email or password is wrong" });
  const owner = await authenticate(email, password);
  if (!owner) return send(res, 401, { error: "Email or password is wrong" });
  const token = await createSession(owner.id);
  return send(res, 200, { user: publicUser(owner) }, { "Set-Cookie": sessionCookie(token, req) });
}

export default guard(handler);
