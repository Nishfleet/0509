---
title: "feat: Surface production readiness evidence"
type: "feat"
date: "2026-06-20"
---

# feat: Surface production readiness evidence

## Summary

Show launch-readiness boundaries on the public status page and keep detailed evidence in private canary checks and signed-in operational views. The product should feel more self-serve without exposing private canary tokens, account activity, or claiming broad launch while Slack, Dodo portal, and uptime blockers remain open.

---

## Problem Frame

0509 already has private launch-readiness canaries and workspace readiness. The remaining customer-facing gap is that operational truth is split between private scripts, docs, and static status copy, so buyers and account owners cannot quickly see which launch blockers remain and where detailed proof lives.

---

## Requirements

**Public operational truth**

- R1. `/status` must render coarse launch blockers and safety posture without account activity, exact aggregate counts, timestamps, or private canary evidence.
- R2. `/status` must keep broad launch gated when Slack delivery proof, Dodo portal confirmation, or external uptime monitoring are not done.
- R3. `/status` must not require or expose the private canary token.

**Signed-in readiness alignment**

- R4. The dashboard readiness area must direct owners to production proof blockers without implying the workspace itself is broken.
- R5. Customer-facing copy must distinguish app-owned self-serve setup from external manual blockers.

**Safety and verification**

- R6. No route may expose API keys, Slack webhooks, customer tokens, canary bypass tokens, or raw provider identifiers.
- R7. Tests must cover ready, blocked, and no-DB status behavior plus dashboard copy boundaries.

---

## Key Technical Decisions

- KTD1. Keep `/status` static and public-safe: launch evidence remains in private canary checks and signed-in operational views.
- KTD2. Keep the private canary route private: `/api/launch-readiness` remains token-gated and `/status` does not read tenant-backed evidence.
- KTD3. Manual blockers stay manual: Dodo portal and external uptime are rendered as explicit manual confirmations, not inferred from code.
- KTD4. Dashboard copy is a pointer, not a launch verdict: Workspace readiness remains account-specific while production readiness lives on `/status`.

---

## Implementation Units

### U1. Add Public Status Boundary

- **Goal:** Make `/status` render safe launch blockers and the private-canary boundary without exposing tenant-backed evidence.
- **Requirements:** R1, R2, R3, R6
- **Dependencies:** None
- **Files:** Modify `app/routes/status.tsx`; add or update route tests.
- **Patterns to follow:** `app/routes/api.launch-readiness.ts`, `app/components/public-doc-shell.tsx`.
- **Test scenarios:** The page renders static blockers and explains that detailed proof is held in authenticated launch-readiness canaries.
- **Verification:** Status route tests pass.

### U2. Align Dashboard Readiness Copy

- **Goal:** Point signed-in owners from the dashboard to public launch blockers without implying `/status` exposes account proof.
- **Requirements:** R4, R5, R6
- **Dependencies:** U1
- **Files:** Modify `app/routes/app.dashboard.tsx`; update dashboard/app rebuild tests if needed.
- **Patterns to follow:** Existing setup checklist and lifecycle nudge panels.
- **Test scenarios:** Dashboard mentions public status/production boundaries when setup is incomplete or delivery proof is missing, and does not expose secrets, account activity, or broad-launch claims.
- **Verification:** App rebuild and relevant dashboard tests pass.

### U3. Keep Docs and Markdown Truth in Sync

- **Goal:** Update public markdown and docs only if the new status evidence changes buyer-facing truth.
- **Requirements:** R2, R5, R7
- **Dependencies:** U1
- **Files:** Modify `app/lib/public-markdown.ts`, `docs/launch-readiness.md`, and related tests only if needed.
- **Patterns to follow:** Existing launch-safe wording in `app/lib/public-markdown.ts` and `docs/launch-readiness.md`.
- **Test scenarios:** Public markdown still says broad launch is gated by real proof and does not claim unsupported channels.
- **Verification:** Public markdown tests pass.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- Adding a real Slack webhook target and rerunning live canaries.
- Confirming the Dodo customer portal dashboard setting.
- Creating the external uptime monitor.
- Persisting historical canary run records beyond the existing aggregate database signals.

### Outside This Product's Identity

- Publicly exposing private canary endpoints or tokens.
- Claiming SOC 2, zero retention, broad social ingestion, or broad public write APIs.

---

## Risks & Dependencies

- **Stale-proof risk:** Public copy must not suggest `/status` renders private or tenant-backed evidence.
- **Secret exposure risk:** Status must avoid counts, timestamps, target values, and tokens.
- **Trust risk:** A green local workspace must not become a broad-launch claim while manual blockers remain.

---

## Sources / Research

- `docs/strategy/2026-06-18-agent-native-self-serve-benchmark.md`
- `docs/launch-readiness.md`
- `app/routes/status.tsx`
- `app/routes/api.launch-readiness.ts`
- `app/lib/data.server.ts`
- `app/routes/app.dashboard.tsx`
- `tests/launch-readiness.route.test.ts`
- `tests/public-markdown.test.ts`
