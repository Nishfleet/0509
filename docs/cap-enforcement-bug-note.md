# CAP ENFORCEMENT BUG — provider ceiling note

Date: 2026-08-18
Status: Note for the CAP ENFORCEMENT BUG ticket (fleet2, priority=normal)
Scope: OpenRouter free-model rate-limit gate

## Note (verbatim from INBOX)

> [2026-08-18T17:23:21.000Z] [fleet2] priority=normal NOTE for CAP ENFORCEMENT
> BUG ticket: provider ceiling verified live — OpenRouter key is paid-tier
> (is_free_tier=false), so `:free` models allow ~1000 req/day ACCOUNT-WIDE
> shared across all `or-*-free` lanes, ~20 req/min. laguna caps raised to
> 900/day 6300/week (Nish order). If more OR free lanes get enabled, their
> combined daily caps must stay under 1000 — encode that as a shared-pool
> constraint when fixing the gate.

## Facts to encode when fixing the gate

- **Provider ceiling (verified live):** the OpenRouter key is paid-tier
  (`is_free_tier=false`), so `:free` models are limited to **~1000 req/day
  ACCOUNT-WIDE**, shared across **all** `or-*-free` lanes, at **~20 req/min**.
- **laguna caps (Nish order):** raised to **900/day** and **6300/week**.
- **Shared-pool constraint:** if more OR free lanes get enabled, their
  combined daily caps must stay **under 1000** — the gate must enforce this
  as a shared-pool constraint, not per-lane.

## Rollback

N/A — documentation-only note; no product code, data, or billing change.
