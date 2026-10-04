import assert from "node:assert/strict";
import test from "node:test";
import { agentPayload, appBaseFromRequest, originMatchesApp, voiceSession } from "../api/_lib/voice.js";

test("phone tools use the deployment host and keep the secret out of the URL", () => {
  delete process.env.APP_ORIGIN;
  delete process.env.ALLOWED_ORIGIN;
  const secret = "super-secret-value";
  const payload = agentPayload({
    ownerId: "owner-12345678",
    base: "https://clientbrain-plus-ruby.vercel.app",
    secret
  });
  const browser = voiceSession();
  assert.equal(payload.system_prompt, browser.system_prompt);
  assert.equal(payload.greeting, browser.greeting);
  assert.deepEqual(payload.tools.map((tool) => tool.name), browser.tools.map((tool) => tool.name));
  for (const tool of payload.tools) {
    const url = new URL(tool.http.url);
    assert.equal(url.host, "clientbrain-plus-ruby.vercel.app");
    assert.equal(url.searchParams.get("tool"), tool.name);
    assert.equal(url.searchParams.has("tool_key"), false);
    assert.equal(url.search.includes(secret), false);
    assert.equal(tool.http.headers.find((header) => header.name === "X-ClientBrain-Tool-Key").value, secret);
  }
});

test("a caller origin cannot choose where tools are sent", () => {
  delete process.env.APP_ORIGIN;
  delete process.env.ALLOWED_ORIGIN;
  const req = {
    headers: {
      origin: "https://evil.example",
      "x-forwarded-host": "clientbrain-plus-ruby.vercel.app",
      "x-forwarded-proto": "https"
    }
  };
  const base = appBaseFromRequest(req);
  assert.equal(base, "https://clientbrain-plus-ruby.vercel.app");
  assert.equal(originMatchesApp(req, base), false);
});
