# EchoPilot — WhatsApp AI Auto-Reply Agent (PRD)

## Original Problem Statement
User wants an agent that, when they are not available on WhatsApp, analyzes their exported chats (how they talk with friends/family), and auto-replies to unseen messages after a delay (~5 min) in the user's own language and style, per chat.

## User Choices
- Simulation mode MVP (WhatsApp export upload + in-app chat simulator), designed so WhatsApp Business Cloud API can be added later
- Claude Sonnet 4.6 via Emergent LLM key for style analysis + reply generation
- Configurable auto-reply delay per contact
- Separate style/tone learned per contact
- WhatsApp-like green & dark theme

## Architecture
- **Backend**: FastAPI + MongoDB (motor). WhatsApp .txt export parser (Android + iOS formats, media/system lines skipped), per-contact style profile via Claude (`emergentintegrations` LlmChat, streamed + aggregated), auto-reply generation using style profile + real message examples + recent conversation.
- **Frontend**: Expo SDK 54 / expo-router, react-native-keyboard-controller, WhatsApp dark theme (#0B141A / #00A884).
- **Key env**: `EMERGENT_LLM_KEY` in backend/.env.

## API Surface (all /api prefixed)
- GET/PATCH `/settings` (global away_mode)
- POST `/import/preview`, `/import/confirm`, `/demo`
- GET `/contacts`, GET/PATCH/DELETE `/contacts/{id}`, POST `/contacts/{id}/reanalyze`
- GET/POST `/contacts/{id}/messages`, POST `/contacts/{id}/auto-reply`, POST `/contacts/{id}/cancel-pending`

## Screens
- `/` Chats list: away-mode toggle, contact rows (last msg, agent delay badge), demo loader, import FAB
- `/import` 3-step import: upload .txt or paste → pick "who is you" → Claude analyzes style
- `/chat/[id]` Simulator: send as contact or as self, countdown banner ("Agent replies in Xs", cancel "I'm here"), typing indicator, AI agent bubbles tagged "AI Agent · as {user}"
- `/contact/[id]` Agent settings: enable toggle, delay chips (5s–5min), learned style card (languages, tone, phrases, quirks), re-analyze, delete

## Implemented (Jun 2026 — MVP)
- Full flow tested end-to-end by testing agent: 18/18 backend tests, all frontend flows pass
- Style learning verified (demo Hinglish chat → Hinglish auto-replies)

## Implemented (Jun 2026 — Iteration 2)
- **WhatsApp Business Cloud API (ready-to-connect)**: `/connect` screen — paste Meta Access Token + Phone Number ID (verified live against Graph API v21.0), auto-generated webhook verify token, copyable webhook URL (`/api/whatsapp/webhook`). Webhook GET verification (hub.challenge) + POST message receive. Live auto-replies only for contacts with a linked `wa_number` (per-contact delay honored, away-mode + agent toggles re-checked at fire time); unknown numbers skipped + logged. NOTE: not connected to a real Meta app yet — user must supply credentials on the Connect screen.
- **Per-contact custom instructions**: `custom_instructions` field on contact, editable in Agent Rules card on contact profile; injected as override rules into the Claude reply prompt (verified: agent defers plans when told to).
- **Auto-reply history log**: `reply_log` collection + `/logs` screen — every sent/skipped/failed reply from simulator and live WhatsApp with reasons.
- Tested: 11/11 new backend tests + frontend flows pass (iteration_2 report).

## Backlog
- P2: Per-contact custom instructions ✅ done (iter 2)
- P2: Auto-reply log/history view ✅ done (iter 2) — "was this reply good?" feedback still open
- P2: Scheduled away windows (e.g., auto-on 11pm–7am)
- P2: Multiple/group-chat imports per contact, merge history

## Notes
- No auth in app (single-user MVP) — /app/memory/test_credentials.md not applicable
- Known cosmetic: RN-web shadow* deprecation warning on FAB (web preview only, native fine)
