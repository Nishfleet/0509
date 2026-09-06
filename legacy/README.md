# Legacy code

Pre-Cloudflare reference material. **Not part of the live build.**

Active auth is Better Auth on Cloudflare D1. Supabase in this folder is legacy-only and should not be migrated forward by default.

## Contents

- `src/` — Next.js prototype that predated the React Router v7 + Cloudflare Workers rewrite. Routes, components, and API handlers are kept for historical reference only. No code in `app/` or `workers/` imports from here.
- `supabase/` — Supabase configuration from the pre-Cloudflare backend. Decommissioned in favor of Better Auth + D1. Kept only for reference if you need to recall schema decisions or RLS policies that informed the D1 migrations.

## Why keep this?

When a feature lands in the live app, it's sometimes useful to check how the old prototype handled the same problem — especially for auth flows, RLS-style access control, and the original Next.js routing conventions.

## Rules

- Do **not** add new code here.
- Do **not** import from here in the live app.
- Moving files out of `legacy/` should be a deliberate, PR-scoped decision.
- If something in here turns out to be completely dead (no reference value), delete it in a follow-up pass.
