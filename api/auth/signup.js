import { normalizeEmail, publicUser, sessionCookie, validEmail } from "../_lib/auth.js";
import { createOwner, createSession } from "../_lib/db.js";
import { guard, readBody, send } from "../_lib/http.js";

async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const body = await readBody(req);
  const email = normalizeEmail(body.email);
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!validEmail(email)) return send(res, 400, { error: "Enter a valid email" });
  if (name.length < 1 || name.length > 80) return send(res, 400, { error: "Enter your name" });
  if (password.length < 8 || password.length > 200) return send(res, 400, { error: "Use at least 8 characters for the password" });
  const created = await createOwner({ email, name, password });
  if (created.error) return send(res, 409, { error: created.error });
  const token = await createSession(created.owner.id);
  return send(res, 200, { user: publicUser(created.owner) }, { "Set-Cookie": sessionCookie(token, req) });
}

export default guard(handler);
