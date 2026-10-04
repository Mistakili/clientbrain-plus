import { suppliedToolName } from "./_lib/auth.js";
import { requireOwner } from "./_lib/access.js";
import { createFollowup, createLead, findLead, listBook, updateLead } from "./_lib/db.js";
import { guard, readBody, send, toolArgs } from "./_lib/http.js";

async function handler(req, res) {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  if (req.method === "GET") return send(res, 200, await listBook(owner.id));
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method not allowed" });
  const body = await readBody(req);
  const tool = suppliedToolName(req, body);
  const args = toolArgs(body);
  const result = await runTool(owner.id, tool, args);
  const status = result.status || (result.ok === false && !result.message ? 400 : 200);
  const payload = { ...result };
  delete payload.status;
  return send(res, status, payload);
}

async function runTool(ownerId, tool, args) {
  if (tool === "create_lead") return createLead(ownerId, args);
  if (tool === "get_lead") {
    const found = await findLead(ownerId, args.name);
    if (found.ok) return found;
    return { ok: false, message: found.message };
  }
  if (tool === "update_lead") return updateLead(ownerId, args);
  if (tool === "create_followup") return createFollowup(ownerId, args);
  return { ok: false, status: 400, error: "Unknown CRM tool" };
}

export default guard(handler);
