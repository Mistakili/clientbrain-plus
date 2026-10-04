import { requireOwner } from "./_lib/access.js";
import { createHandoff, listHandoffs } from "./_lib/db.js";
import { guard, readBody, send, toolArgs } from "./_lib/http.js";

async function handler(req, res) {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  if (req.method === "GET") return send(res, 200, { ok: true, handoffs: await listHandoffs(owner.id) });
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method not allowed" });

  const args = toolArgs(await readBody(req));
  const reason = String(args.reason || "Human assistance requested").trim();
  const summary = String(args.summary || "Caller requested human assistance.").trim();
  const target = String(args.target_user || process.env.HUMAN_TRANSFER_NUMBER || "").trim();
  const handoff = await createHandoff(owner.id, { reason, summary, target });

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !target) {
    return send(res, 200, {
      ok: true,
      status: "pending_setup",
      message: "Human transfer is not connected yet. Take the caller's details and offer a callback.",
      handoff
    });
  }

  return send(res, 200, {
    ok: true,
    status: "ready_for_twilio_call_control",
    message: "Human handoff request accepted.",
    handoff
  });
}

export default guard(handler);
