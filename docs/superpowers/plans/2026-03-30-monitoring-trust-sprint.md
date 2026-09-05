# Monitoring Trust Sprint Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the remaining monitoring trust gap by surfacing run summary diagnostics and rewriting the sprint docs so they match the shipped code.

**Architecture:** Keep the current Cloudflare-native app as-is. Most of the trust hardening is already shipped, so this closeout step only adds missing watchlist-run visibility in the UI and rewrites the trust-sprint docs to distinguish shipped work from remaining work.

**Tech Stack:** React Router v7 on Cloudflare Workers, Better Auth, D1, R2, Resend, TypeScript, Vitest

---

## Delivery Context

### Already Done

- Cloudflare-native rebuild shipped
- Better Auth + D1 auth/data layer shipped
- Analysis flow shipped: search, provenance, LP snapshot, save, collections, exports, sharing
- Monitoring model shipped: watchlists, runs, events, digests, scheduled worker
- Early India-first marketing shipped before the current fixed-INR plus Dodo local-pricing model
- `searchAds(...)` fallback contract shipped
- strict monitoring scan behavior shipped
- watchlist dedup schema + create-path handling shipped
- digest period idempotency shipped
- digest snapshot rendering shipped
- owner-scoped share creation shipped
- repo truth rewrite in `README.md`, `MEMORY.md`, and `CLAUDE.md` shipped

### This Sprint

- Surface run summary counts in watchlist history
- Rewrite the trust sprint docs so they are no longer stale

### After This Sprint

- Analysis depth: OCR, translation, richer LP fields
- Agency workflow enhancements: stronger client-ready outputs
- Billing/entitlements only after trust + retention loop are stable

## Task 1: Surface Watchlist Run Diagnostics

**Files:**
- Modify: `app/routes/app.watchlists.tsx`

- [ ] Read the existing `WatchlistRun.summary` shape so the UI only renders fields that are already stored.
- [ ] Add a small formatter/helper for `adsSeen`, `events`, and `eventTypes`.
- [ ] Render those summary counts in the “Recent runs” cards without removing the current timestamps, page count, baseline, or error text.
- [ ] Run: `npm run typecheck`

## Task 2: Rewrite The Sprint Docs To Match Reality

**Files:**
- Modify: `docs/superpowers/specs/2026-03-30-monitoring-trust-sprint-design.md`
- Modify: `docs/superpowers/plans/2026-03-30-monitoring-trust-sprint.md`

- [ ] Replace stale “pending” trust tasks with an explicit “already done / this step / after this step” split.
- [ ] Remove source-integrity, digest-idempotency, share-hardening, and repo-truth tasks that already shipped.
- [ ] Keep the next recommended slice explicit: analysis depth before more workflow chrome.

## Final Verification

**Files:**
- Verify all touched files

- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run build`
- [ ] Summarize what was already done, what changed in this closeout step, and what comes next
