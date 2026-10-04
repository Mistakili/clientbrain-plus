# Agent Picko

**Talk to your CRM.** A voice-first real-estate CRM. Speak a new lead, look someone up, correct their details, or set a follow-up.

## What you can do

- Create an account and keep a private book of leads, follow-ups, and handoffs
- Talk to that book in the browser, with a live transcript
- Create a lead from natural speech, or update one when the name already exists
- Look up a saved lead by name
- Update details the caller actually gave
- Create a follow-up reminder
- Ask to be connected to a person
- Keep the voice API key on the server and give the browser a short-lived token

## Run locally

Node 22.13 or newer. The interface is a Vite app. Accounts, voice, CRM, and handoff routes are Vercel functions under `api/`, so a plain `npm run dev` serves the page without those routes.

1. Copy `.env.example` to `.env`.
2. Set `ASSEMBLYAI_API_KEY`.
3. Set `CLIENTBRAIN_TOOL_SECRET` to a random string of at least 16 characters.
4. Set `APP_ORIGIN` and `ALLOWED_ORIGIN` to the URL you open in the browser.
5. Leave `DATABASE_URL` empty. Local data is stored in `data/clientbrain-plus.db`.
6. Run `npm install`, then `vercel dev`.

`npm run dev` only previews the interface. Use headphones so the microphone does not hear the spoken reply.

## Accounts

Sign in from the workspace. Each account has its own leads, follow-ups, and handoffs. The browser sends a session cookie. Phone tools send `CLIENTBRAIN_TOOL_SECRET` in a header, with the account id, to the deployment host.

## Security

`GET /api/voice-token` asks AssemblyAI for a short-lived, single-use token after you are signed in. The permanent API key stays in server environment variables.

Set `ALLOWED_ORIGIN` to the exact origins that may request a token, comma-separated. Localhost is allowed in addition to that list.

`CLIENTBRAIN_TOOL_SECRET` has to be set. CRM and handoff routes refuse to run without it. A signed-in browser uses its session. A phone tool must present the secret and an account id. The secret is sent in a header on the phone agent, not stored in the page.

`POST /api/create-agent` requires a signed-in account. Tool URLs are built from `APP_ORIGIN`, or from this deployment's host when that is unset. A caller's `Origin` header cannot point those tools somewhere else. The browser and the phone agent share one prompt, greeting, voice, and tool list.

## Data

Local runs use a SQLite file at `data/clientbrain-plus.db`. A deployed app needs `DATABASE_URL` pointing at a Postgres database for Agent Picko. That database is not the production Client Brain database, and this repository does not include production Client Brain accounts or credentials.

Human handoff records the request. Connecting the call is still a separate step.
