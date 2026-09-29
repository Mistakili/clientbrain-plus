# ClientBrain Plus

**Talk to your CRM.** A voice-first real-estate CRM prototype built for the AssemblyAI Voice Agent challenge.

## What it demonstrates

- Real-time browser voice conversation using AssemblyAI Voice Agent API
- Secure short-lived browser tokens; the AssemblyAI API key stays server-side
- JSON-schema tool calling for CRM actions
- Create leads from natural speech
- Look up saved leads
- Create follow-up reminders
- Live transcript and CRM dashboard

## Run locally

Create an AssemblyAI API key, copy `.env.example` to `.env`, set `ASSEMBLYAI_API_KEY`, then run `npm install` and `npm run dev`.

Use headphones while testing to reduce acoustic echo.

## Security

The browser receives a short-lived, single-use AssemblyAI token from `/api/voice-token`; the permanent API key is never shipped to the client. Set `ALLOWED_ORIGIN` to the exact deployed origin.

## Hackathon scope

This is a focused prototype. CRM data is intentionally in-memory for the demo; production ClientBrain data and credentials are not included in this public repository.
