import { createHash } from "node:crypto";
import { getVoiceAgent, saveVoiceAgent } from "./db.js";
import { agentPayload } from "./voice.js";

async function assemblyFetch(url, key, body, method) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  return { response, data };
}

export async function ensureAgent({ ownerId, base, secret }) {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return { error: "ASSEMBLYAI_API_KEY is not configured" };
  const payload = agentPayload({ ownerId, base, secret });
  const configHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const existing = await getVoiceAgent(ownerId);
  if (existing?.config_hash === configHash) return { agent_id: existing.agent_id };
  if (existing?.agent_id) {
    const updated = await assemblyFetch(`https://agents.assemblyai.com/v1/agents/${existing.agent_id}`, key, payload, "PUT");
    if (updated.response.ok) {
      await saveVoiceAgent(ownerId, existing.agent_id, configHash);
      return { agent_id: existing.agent_id };
    }
  }
  const created = await assemblyFetch("https://agents.assemblyai.com/v1/agents", key, payload, "POST");
  if (!created.response.ok || !created.data?.id) {
    return { error: created.data?.error || "Voice agent setup failed" };
  }
  await saveVoiceAgent(ownerId, created.data.id, configHash);
  return { agent_id: created.data.id };
}
