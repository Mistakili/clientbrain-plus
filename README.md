# ClientBrain Plus

**Talk to your CRM.** A voice-first real-estate CRM. Speak a new lead, look someone up, correct their details, or set a follow-up.

## What you can do

- Talk to the CRM in the browser, with a live transcript
- Create a lead from natural speech
- Look up a saved lead by name
- Update details the caller actually gave
- Create a follow-up reminder
- Ask to be connected to a person
- Keep the voice API key on the server and give the browser a short-lived token

## Run locally

The interface is a Vite app. The voice token, CRM, and handoff routes are Vercel functions under `api/`, so a plain `npm run dev` serves the page without those routes.

1. Create an AssemblyAI API key.
2. Copy `.env.example` to `.env`.
3. Set `ASSEMBLYAI_API_KEY`.
4. For a full local run, use the Vercel CLI (`vercel dev`) so `/api/*` is available.
5. `npm install`, then `npm run dev`, is enough to preview the interface on its own.

Use headphones while testing so the microphone does not hear the spoken reply.

## Security

`GET /api/voice-token` asks AssemblyAI for a short-lived, single-use token. The browser uses that token for the voice socket. The permanent API key stays in server environment variables.

Set `ALLOWED_ORIGIN` to the exact origins that may request a token, comma-separated. Localhost is allowed in addition to that list.

`CLIENTBRAIN_TOOL_SECRET`, when set, is required on CRM and handoff requests. The phone agent appends it to its tool URLs. Leave it set in any deployed environment.

## Data

Leads, follow-ups, activity, and handoffs are stored in memory on the server process. They reset when that process restarts, and separate server instances do not share one book. This repository does not include production Client Brain accounts or credentials.
