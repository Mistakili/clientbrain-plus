import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import signup from "../api/auth/signup.js";
import crm from "../api/crm.js";
import createAgent from "../api/create-agent.js";
import transfer from "../api/transfer.js";

const dir = mkdtempSync(path.join(tmpdir(), "cbp-"));
process.env.CLIENTBRAIN_DB_PATH = path.join(dir, "book.db");
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
delete process.env.APP_ORIGIN;
delete process.env.ALLOWED_ORIGIN;
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
process.env.CLIENTBRAIN_TOOL_SECRET = "test-secret-value-0123456789";

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = JSON.stringify(data);
      return this;
    },
    end(value) {
      this.body = value;
      return this;
    }
  };
}

async function call(handler, { method = "GET", body, headers = {}, query = {} } = {}) {
  const req = { method, body, headers, query };
  const res = mockRes();
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, json: res.body ? JSON.parse(res.body) : {} };
}

function sessionCookie(headers) {
  const match = /cb_plus_session=([^;]+)/.exec(headers["set-cookie"] || "");
  return match ? decodeURIComponent(match[1]) : "";
}

test("each account keeps its own book and tools stay closed", async () => {
  const ada = await call(signup, { method: "POST", body: { email: "ada@example.com", name: "Ada", password: "password-1" } });
  const dan = await call(signup, { method: "POST", body: { email: "dan@example.com", name: "Dan", password: "password-2" } });
  assert.equal(ada.status, 200);
  assert.equal(ada.json.user.password_hash, undefined);
  const adaCookie = sessionCookie(ada.headers);
  const danCookie = sessionCookie(dan.headers);

  const created = await call(crm, {
    method: "POST",
    headers: { cookie: `cb_plus_session=${adaCookie}` },
    body: { tool: "create_lead", arguments: { name: "Sarah Connor", location: "Akobo", property_type: "plot" } }
  });
  assert.equal(created.json.created, true);

  const again = await call(crm, {
    method: "POST",
    headers: { cookie: `cb_plus_session=${adaCookie}` },
    body: { tool: "create_lead", name: "Sarah Connor", budget: "25m" }
  });
  assert.equal(again.json.created, false);
  assert.equal(again.json.lead.id, created.json.lead.id);
  assert.equal(again.json.lead.budget, "25m");
  assert.equal(again.json.lead.location, "Akobo");

  await call(crm, {
    method: "POST",
    headers: { cookie: `cb_plus_session=${adaCookie}` },
    body: { tool: "create_lead", arguments: { name: "Joanna Blake" } }
  });
  const wrong = await call(crm, {
    method: "POST",
    headers: { cookie: `cb_plus_session=${adaCookie}` },
    body: { tool: "get_lead", arguments: { name: "Ann" } }
  });
  assert.equal(wrong.json.lead, undefined);
  const right = await call(crm, {
    method: "POST",
    headers: { cookie: `cb_plus_session=${adaCookie}` },
    body: { tool: "get_lead", arguments: { name: "Joa" } }
  });
  assert.equal(right.json.lead.name, "Joanna Blake");

  const danBook = await call(crm, { headers: { cookie: `cb_plus_session=${danCookie}` } });
  assert.deepEqual(danBook.json.leads, []);

  const secret = process.env.CLIENTBRAIN_TOOL_SECRET;
  const crossed = await call(crm, {
    headers: {
      cookie: `cb_plus_session=${danCookie}`,
      "x-clientbrain-tool-key": secret,
      "x-clientbrain-owner": ada.json.user.id
    }
  });
  assert.deepEqual(crossed.json.leads, []);

  const byTool = await call(crm, {
    headers: { "x-clientbrain-tool-key": secret, "x-clientbrain-owner": ada.json.user.id }
  });
  assert.equal(byTool.json.leads.length, 2);

  const open = await call(crm, {});
  assert.equal(open.status, 401);

  const handoff = await call(transfer, {
    method: "POST",
    headers: { "x-clientbrain-tool-key": secret, "x-clientbrain-owner": ada.json.user.id },
    body: { reason: "Asked for a person", summary: "Buyer wants a callback" }
  });
  assert.equal(handoff.json.status, "pending_setup");
  assert.match(handoff.json.message, /not connected yet/);

  const blocked = await call(createAgent, {
    method: "POST",
    headers: {
      cookie: `cb_plus_session=${adaCookie}`,
      origin: "https://evil.example",
      host: "localhost:3000",
      "x-forwarded-proto": "http"
    },
    body: { url: "https://evil.example/steal" }
  });
  assert.equal(blocked.status, 400);

  process.env.CLIENTBRAIN_TOOL_SECRET = "short";
  const missing = await call(crm, { headers: { cookie: `cb_plus_session=${adaCookie}` } });
  assert.equal(missing.status, 500);
});
