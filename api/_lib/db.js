import { mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { hashPassword, newToken, tokenHash, verifyPassword } from "./auth.js";
import { matchLead, nameKey, provided } from "./names.js";

const LEAD_FIELDS = ["property_type", "location", "budget", "timeline", "notes"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  property_type TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  budget TEXT NOT NULL DEFAULT '',
  timeline TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, name_key)
);
CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  when_text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  summary TEXT NOT NULL,
  target_user TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS voice_agents (
  owner_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

let backend;

function toPg(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function isUniqueError(error) {
  return error?.code === "23505" || /UNIQUE/i.test(String(error?.message || ""));
}

function sqliteFile() {
  if (process.env.CLIENTBRAIN_DB_PATH) return process.env.CLIENTBRAIN_DB_PATH;
  return path.join(process.cwd(), "data", "clientbrain-plus.db");
}

async function openBackend() {
  if (backend) return backend;
  const databaseUrl = String(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "").trim();
  if (process.env.VERCEL && !databaseUrl) {
    throw new Error("DATABASE_URL is required on Vercel. Use a database for Agent Picko, separate from production Client Brain.");
  }
  if (databaseUrl) {
    const ssl = /sslmode=require/i.test(databaseUrl) || Boolean(process.env.VERCEL);
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      max: 1
    });
    for (const statement of SCHEMA.split(";").map((part) => part.trim()).filter(Boolean)) {
      await pool.query(statement);
    }
    backend = {
      async get(sql, params = []) {
        const result = await pool.query(toPg(sql), params);
        return result.rows[0] || null;
      },
      async all(sql, params = []) {
        const result = await pool.query(toPg(sql), params);
        return result.rows;
      },
      async run(sql, params = []) {
        const result = await pool.query(toPg(sql), params);
        return { changes: result.rowCount };
      }
    };
    return backend;
  }
  const { DatabaseSync } = await import("node:sqlite");
  const file = sqliteFile();
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  backend = {
    async get(sql, params = []) {
      return db.prepare(sql).get(...params) || null;
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { changes: Number(info.changes || 0) };
    }
  };
  return backend;
}

export async function resetDatabaseForTests() {
  backend = null;
}

function leadFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    name_key: row.name_key,
    property_type: row.property_type || "—",
    location: row.location || "—",
    budget: row.budget || "—",
    timeline: row.timeline || "—",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at || null
  };
}

function publicLead(lead) {
  if (!lead) return null;
  const copy = { ...lead };
  delete copy.name_key;
  return copy;
}

export async function createOwner({ email, name, password }) {
  const db = await openBackend();
  const now = new Date().toISOString();
  const owner = {
    id: crypto.randomUUID(),
    email,
    name,
    password_hash: hashPassword(password),
    created_at: now
  };
  try {
    await db.run(
      "INSERT INTO owners (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      [owner.id, owner.email, owner.name, owner.password_hash, owner.created_at]
    );
  } catch (error) {
    if (isUniqueError(error)) return { error: "An account with that email already exists" };
    throw error;
  }
  return { owner };
}

export async function authenticate(email, password) {
  const db = await openBackend();
  const row = await db.get("SELECT * FROM owners WHERE email = ?", [email]);
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return row;
}

export async function createSession(ownerId) {
  const db = await openBackend();
  const token = newToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    "INSERT INTO sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)",
    [tokenHash(token), ownerId, expires]
  );
  return token;
}

export async function deleteSession(token) {
  if (!token) return;
  const db = await openBackend();
  await db.run("DELETE FROM sessions WHERE token_hash = ?", [tokenHash(token)]);
}

export async function ownerFromToken(token) {
  if (!token) return null;
  const db = await openBackend();
  const row = await db.get(
    `SELECT owners.* FROM sessions
     JOIN owners ON owners.id = sessions.owner_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    [tokenHash(token), new Date().toISOString()]
  );
  return row || null;
}

export async function ownerById(id) {
  if (!id) return null;
  const db = await openBackend();
  return db.get("SELECT id, email, name, created_at FROM owners WHERE id = ?", [id]);
}

async function addActivity(ownerId, type, message, meta = {}) {
  const db = await openBackend();
  await db.run(
    "INSERT INTO activities (id, owner_id, type, message, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [crypto.randomUUID(), ownerId, type, message, JSON.stringify(meta), new Date().toISOString()]
  );
  await db.run(
    `DELETE FROM activities WHERE owner_id = ? AND id NOT IN (
      SELECT id FROM activities WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50
    )`,
    [ownerId, ownerId]
  );
}

export async function listBook(ownerId) {
  const db = await openBackend();
  const leads = (await db.all(
    "SELECT * FROM leads WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1000",
    [ownerId]
  )).map((row) => publicLead(leadFromRow(row)));
  const followups = (await db.all(
    "SELECT * FROM followups WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1000",
    [ownerId]
  )).map((row) => ({
    id: row.id,
    name: row.name,
    when: row.when_text,
    note: row.note,
    createdAt: row.created_at
  }));
  const activities = await db.all(
    "SELECT id, type, message, created_at FROM activities WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50",
    [ownerId]
  );
  return {
    leads,
    followups,
    activities: activities.map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      createdAt: row.created_at
    }))
  };
}

async function leadsForOwner(ownerId) {
  const db = await openBackend();
  const rows = await db.all("SELECT * FROM leads WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1000", [ownerId]);
  return rows.map(leadFromRow);
}

export async function createLead(ownerId, args, attempt = 0) {
  const name = String(args.name || "").trim();
  const key = nameKey(name);
  if (!key) return { ok: false, status: 400, error: "A name is required" };
  const db = await openBackend();
  const existing = (await leadsForOwner(ownerId)).find((lead) => lead.name_key === key);
  const now = new Date().toISOString();
  if (existing) {
    const next = { ...existing, name, updatedAt: now };
    for (const field of LEAD_FIELDS) {
      if (provided(args[field])) next[field] = String(args[field]).trim();
    }
    await db.run(
      `UPDATE leads SET name = ?, property_type = ?, location = ?, budget = ?, timeline = ?, notes = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
      [next.name, blank(next.property_type), blank(next.location), blank(next.budget), blank(next.timeline), next.notes || "", now, existing.id, ownerId]
    );
    await addActivity(ownerId, "lead_updated", "Lead details updated", { leadId: existing.id, name: next.name });
    return { ok: true, created: false, lead: publicLead(next) };
  }
  const lead = {
    id: crypto.randomUUID(),
    name,
    name_key: key,
    property_type: provided(args.property_type) ? String(args.property_type).trim() : "—",
    location: provided(args.location) ? String(args.location).trim() : "—",
    budget: provided(args.budget) ? String(args.budget).trim() : "—",
    timeline: provided(args.timeline) ? String(args.timeline).trim() : "—",
    notes: provided(args.notes) ? String(args.notes).trim() : "",
    createdAt: now,
    updatedAt: now
  };
  try {
    await db.run(
      `INSERT INTO leads (id, owner_id, name, name_key, property_type, location, budget, timeline, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [lead.id, ownerId, lead.name, lead.name_key, blank(lead.property_type), blank(lead.location), blank(lead.budget), blank(lead.timeline), lead.notes, now, now]
    );
  } catch (error) {
    if (!isUniqueError(error) || attempt > 0) throw error;
    return createLead(ownerId, args, attempt + 1);
  }
  await addActivity(ownerId, "lead_created", "New lead captured", { leadId: lead.id, name: lead.name });
  return { ok: true, created: true, lead: publicLead(lead) };
}

function blank(value) {
  return value === "—" ? "" : (value || "");
}

export async function findLead(ownerId, query) {
  const leads = await leadsForOwner(ownerId);
  const found = matchLead(leads, query);
  if (found.lead) {
    await addActivity(ownerId, "lead_viewed", "Lead looked up", { leadId: found.lead.id, name: found.lead.name });
    return { ok: true, lead: publicLead(found.lead) };
  }
  if (found.matches.length > 1) {
    return {
      ok: false,
      message: `More than one lead matches. Ask which person: ${found.matches.map((lead) => lead.name).join(", ")}`
    };
  }
  return { ok: false, message: "No lead found" };
}

export async function updateLead(ownerId, args) {
  const leads = await leadsForOwner(ownerId);
  const found = matchLead(leads, args.name);
  if (!found.lead) {
    if (found.matches.length > 1) {
      return { ok: false, status: 404, message: `More than one lead matches. Ask which person: ${found.matches.map((lead) => lead.name).join(", ")}` };
    }
    return { ok: false, status: 404, message: "No lead found" };
  }
  const db = await openBackend();
  const next = { ...found.lead, updatedAt: new Date().toISOString() };
  for (const field of LEAD_FIELDS) {
    if (provided(args[field])) next[field] = String(args[field]).trim();
  }
  await db.run(
    `UPDATE leads SET property_type = ?, location = ?, budget = ?, timeline = ?, notes = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
    [blank(next.property_type), blank(next.location), blank(next.budget), blank(next.timeline), next.notes || "", next.updatedAt, next.id, ownerId]
  );
  await addActivity(ownerId, "lead_updated", "Lead details updated", { leadId: next.id, name: next.name });
  return { ok: true, lead: publicLead(next) };
}

export async function createFollowup(ownerId, args) {
  const name = String(args.name || "").trim();
  const when = String(args.when || "").trim();
  if (!name || !when) return { ok: false, status: 400, error: "A name and a time are required" };
  const db = await openBackend();
  const followup = {
    id: crypto.randomUUID(),
    name,
    when,
    note: String(args.note || "").trim(),
    createdAt: new Date().toISOString()
  };
  await db.run(
    "INSERT INTO followups (id, owner_id, name, when_text, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [followup.id, ownerId, followup.name, followup.when, followup.note, followup.createdAt]
  );
  await addActivity(ownerId, "followup_created", "Follow-up scheduled", { name: followup.name, when: followup.when });
  return { ok: true, followup };
}

export async function listHandoffs(ownerId) {
  const db = await openBackend();
  const rows = await db.all(
    "SELECT * FROM handoffs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100",
    [ownerId]
  );
  return rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    summary: row.summary,
    target_user: row.target_user,
    status: row.status,
    createdAt: row.created_at
  }));
}

export async function createHandoff(ownerId, { reason, summary, target }) {
  const db = await openBackend();
  const handoff = {
    id: crypto.randomUUID(),
    reason,
    summary,
    target_user: target || null,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  await db.run(
    "INSERT INTO handoffs (id, owner_id, reason, summary, target_user, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [handoff.id, ownerId, handoff.reason, handoff.summary, handoff.target_user, handoff.status, handoff.createdAt]
  );
  return handoff;
}

export async function getVoiceAgent(ownerId) {
  const db = await openBackend();
  return db.get("SELECT owner_id, agent_id, config_hash FROM voice_agents WHERE owner_id = ?", [ownerId]);
}

export async function saveVoiceAgent(ownerId, agentId, configHash) {
  const db = await openBackend();
  const now = new Date().toISOString();
  const existing = await getVoiceAgent(ownerId);
  if (existing) {
    await db.run(
      "UPDATE voice_agents SET agent_id = ?, config_hash = ?, updated_at = ? WHERE owner_id = ?",
      [agentId, configHash, now, ownerId]
    );
    return;
  }
  await db.run(
    "INSERT INTO voice_agents (owner_id, agent_id, config_hash, updated_at) VALUES (?, ?, ?, ?)",
    [ownerId, agentId, configHash, now]
  );
}
