export function guard(handler) {
  return async function guarded(req, res) {
    try {
      await handler(req, res);
    } catch (error) {
      if (res.writableEnded || res.headersSent) return;
      send(res, 500, { ok: false, error: error.message || "Request failed" });
    }
  };
}

export function send(res, status, data, headers = {}) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (typeof res.status === "function") {
    const chain = res.status(status);
    if (chain && typeof chain.json === "function" && chain !== res) return chain.json(data);
    if (chain && typeof chain.end === "function" && chain !== res) return chain.end(JSON.stringify(data));
  }
  res.statusCode = status;
  res.end(JSON.stringify(data));
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return {}; }
  }
  if (!req[Symbol.asyncIterator]) return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

export function toolArgs(body) {
  if (body?.arguments && typeof body.arguments === "object") return body.arguments;
  if (body?.args && typeof body.args === "object") return body.args;
  return body || {};
}
