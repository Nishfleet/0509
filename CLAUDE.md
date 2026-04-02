# 0509.in — Meta Competitor Analysis Workspace

## Build
```bash
npm run build
npm test
```

## Dev
```bash
npm run dev
```

## Stack

- React Router v7 on Cloudflare Workers
- Better Auth (email + OAuth)
- D1 (Cloudflare SQLite)
- R2 (artifact storage)
- Resend (email delivery)
- Pure CSS via `app/app.css` (no Tailwind, no CSS-in-JS)
- Vitest for testing

## Architecture

- `app/routes/` — React Router v7 routes (loaders/actions)
- `app/lib/*.server.ts` — server-side logic (D1 queries, Meta API, monitoring, analysis)
- `app/lib/*.ts` — shared logic (language classifier, types, display helpers)
- `workers/app.ts` — Cloudflare Worker entry with scheduled event handler
- `migrations/` — D1 schema migrations (sequential numbered SQL)
- `tests/` — Vitest unit tests (9 files)
- `src/` — legacy Next.js prototype (historical reference only)

## Key Files

- `app/lib/data.server.ts` — D1 CRUD layer (~36KB)
- `app/lib/meta-api.server.ts` — Meta Ad Library API client
- `app/lib/monitoring.server.ts` — watchlist monitoring + digests
- `app/lib/analysis.server.ts` — ad analysis (hook, offer, destination, language)
- `app/lib/landing-page-signals.server.ts` — CTA, price, form extraction
- `app/lib/language-classifier.ts` — Hindi/Hinglish/English/Regional detection
- `app/lib/creative-text.server.ts` — creative text OCR (HTML + Workers AI)

## Current Phase: Analysis Depth

Do NOT add workflow chrome, billing, or new watch event types.
Focus only on: OCR (done), translation, agency reports (done).

## Paperclip

This project is managed by Paperclip under company Swish.
- **Project:** 0509.in (URL key: `0509-in`)
- **SaaS Builder** handles implementation tasks
- **SaaS Reviewer** + **Codex Reviewer** review completed work

## Product Shape

- Analysis is the hook.
- Monitoring is the retention loop.
- Workspace memory is the compounding layer.

## Conventions

- Keep new work in the Cloudflare app unless explicitly touching legacy reference code.
- Favor honest product behavior over optimistic marketing claims.
- If a Meta token is configured and live search fails, monitoring should fail honestly rather than silently degrading into demo-backed success.
- Immutability: create new objects, never mutate existing ones.
- File organization: 200-400 lines typical, 800 max.
- D1 queries: always use parameterized `.bind()` — never string interpolation.
