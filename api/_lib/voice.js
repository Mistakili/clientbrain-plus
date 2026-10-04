export const VOICE_ID = "ivy";

export const GREETING = "Hi — I'm Picko. Tell me about a lead or ask me about someone you've saved.";

export const SYSTEM_PROMPT = [
  "You are Picko, the voice assistant for Agent Picko, a concise voice CRM for real-estate agents.",
  "Help the realtor capture and manage leads by conversation. Ask only for information that is missing. Never invent missing values.",
  "When the user gives you a new lead, use create_lead. If that name is already saved, create_lead updates the existing person.",
  "When asked about a saved lead, use get_lead.",
  "When the user adds or corrects details, use update_lead and only change fields they explicitly provide.",
  "When asked to remember a follow-up, use create_followup.",
  "If the caller explicitly asks for a human or the request needs human assistance, tell them you will connect them and use transfer_to_human with a short reason and summary.",
  "Never invent saved data, confirmations, or successful transfers. Keep spoken replies short and natural."
].join(" ");

const SPECS = [
  {
    name: "create_lead",
    description: "Create a real-estate lead from details the caller provides. Ask for the person's name if it is missing. Never invent missing values. If this name is already saved, the existing lead is updated with the new details.",
    properties: {
      name: { type: "string" },
      property_type: { type: "string" },
      location: { type: "string" },
      budget: { type: "string" },
      timeline: { type: "string" },
      notes: { type: "string" }
    },
    required: ["name"]
  },
  {
    name: "get_lead",
    description: "Look up a saved lead by name. Do not guess details when no lead is returned.",
    properties: { name: { type: "string" } },
    required: ["name"]
  },
  {
    name: "update_lead",
    description: "Update an existing saved lead when the caller adds or corrects details. Never invent values or overwrite fields the caller did not provide.",
    properties: {
      name: { type: "string" },
      property_type: { type: "string" },
      location: { type: "string" },
      budget: { type: "string" },
      timeline: { type: "string" },
      notes: { type: "string" }
    },
    required: ["name"]
  },
  {
    name: "create_followup",
    description: "Create a follow-up reminder for a lead.",
    properties: {
      name: { type: "string" },
      when: { type: "string" },
      note: { type: "string" }
    },
    required: ["name", "when"]
  },
  {
    name: "transfer_to_human",
    description: "Transfer the caller to a human real-estate agent when they explicitly ask for a person or the request needs human assistance. Tell the caller you are connecting them, then call this tool with a short reason and summary.",
    properties: {
      reason: { type: "string" },
      summary: { type: "string" }
    },
    required: ["reason", "summary"],
    hold: true
  }
];

function parameters(spec) {
  return { type: "object", properties: spec.properties, required: spec.required };
}

export function browserTools() {
  return SPECS.map((spec) => ({
    type: "function",
    name: spec.name,
    description: spec.description,
    parameters: parameters(spec),
    ...(spec.hold ? { execution_mode: "hold", timeout_seconds: 60 } : {})
  }));
}

export function voiceSession() {
  return {
    system_prompt: SYSTEM_PROMPT,
    greeting: GREETING,
    voice: VOICE_ID,
    tools: browserTools()
  };
}

export function cleanBase(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

// Tool calls must target this deployment. The browser Origin header is not a host we control.
export function appBaseFromRequest(req) {
  const configured = cleanBase(process.env.APP_ORIGIN);
  if (configured) return configured;
  const host = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "").split(",")[0].trim();
  if (!host) return "";
  const proto = String(req.headers?.["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
  return `${proto}://${host}`;
}

export function originMatchesApp(req, base) {
  const origin = String(req.headers?.origin || "").trim();
  if (!origin) return true;
  let originUrl = "";
  let baseUrl = "";
  try {
    originUrl = new URL(origin).origin;
    baseUrl = new URL(base).origin;
  } catch {
    return false;
  }
  if (originUrl === baseUrl) return true;
  const allowed = String(process.env.ALLOWED_ORIGIN || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (allowed.includes(originUrl)) return true;
  return originUrl.startsWith("http://localhost:") || originUrl.startsWith("http://127.0.0.1:");
}

export function toolEndpoint({ base, secret, ownerId, toolName }) {
  const path = toolName === "transfer_to_human" ? "/api/transfer" : "/api/crm";
  const url = new URL(path, `${cleanBase(base)}/`);
  url.searchParams.set("owner_id", ownerId);
  url.searchParams.set("tool", toolName);
  return {
    url: url.toString(),
    headers: [
      { name: "X-ClientBrain-Tool-Key", value: secret },
      { name: "X-ClientBrain-Owner", value: ownerId },
      { name: "X-ClientBrain-Tool", value: toolName }
    ]
  };
}

export function agentPayload({ ownerId, base, secret }) {
  const tools = SPECS.map((spec) => {
    const endpoint = toolEndpoint({ base, secret, ownerId, toolName: spec.name });
    return {
      name: spec.name,
      description: spec.description,
      parameters: parameters(spec),
      ...(spec.hold ? { execution_mode: "hold", timeout_seconds: 60 } : {}),
      http: { url: endpoint.url, http_method: "POST", headers: endpoint.headers }
    };
  });
  return {
    name: `Agent Picko ${String(ownerId).slice(0, 8)}`,
    system_prompt: SYSTEM_PROMPT,
    greeting: GREETING,
    voice: { voice_id: VOICE_ID },
    tools
  };
}
