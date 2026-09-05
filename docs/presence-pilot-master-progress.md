# Presence Website Pilot — Master Progress

Last updated: 2026-06-24
Coordinator branch: `cursor/presence-pilot-rollout-20260624`
Integration base: `main` @ `7776eb3`

## File ownership manifest

| Workstream | Branch | Primary files |
|------------|--------|---------------|
| **A — Sync integrity** | `cursor/presence-sync-integrity-20260624` | `migrations/0058_presence_sync_integrity.sql`, `app/lib/presence-data.server.ts` (revisions, reconcile), `app/lib/presence-service.server.ts` (post-poll reconcile, syncCycleCount) |
| **B — Crawler quality** | `cursor/presence-crawler-quality-20260624` | `app/lib/presence-connectors/website.server.ts` (feed budget, completeSnapshot), `app/lib/presence-robots.server.ts`, `tests/presence-robots.test.ts`, `tests/presence-safe-fetch.test.ts` |
| **C — Pilot UX** | `cursor/presence-pilot-experience-20260624` | `app/routes/app.presence.tsx`, `app/routes/app.presence.$entityId.tsx`, `app/lib/presence-display.ts`, `app/lib/presence-digest.server.ts` |
| **D — Ops / release** | `cursor/presence-ops-release-20260624` | `scripts/presence-pilot-canary.mjs`, `scripts/presence-website-canary.mjs`, `docs/presence-pilot-runbook.md`, `docs/presence-incident-runbook.md` |
| **Shared rollout** | `cursor/presence-pilot-rollout-20260624` | `migrations/0057_presence_pilot_workspace.sql`, `app/lib/presence-pilot-access.server.ts`, `app/lib/presence-internal-access.server.ts`, `app/lib/presence-access-gates.server.ts`, `wrangler.jsonc` |
| **E — Security (read-only)** | — | Review only: SSRF, OAuth, robots, rollout bypass, XSS, secrets |
| **F — Release reviewer (read-only)** | — | D1 durability, sync cycles, deploy gate |

## Phase 0 baseline (verified 2026-06-24)

| Check | Result |
|-------|--------|
| `main` hash | `7776eb3a0ce4d4e66ea855d61fa89b72dedf28e8` |
| `origin/main` | `7776eb3a0ce4d4e66ea855d61fa89b72dedf28e8` (in sync) |
| PR #240 | MERGED — docs provenance |
| PR #241 | MERGED — `PRESENCE_WEBSITE_ROLLOUT=internal` in wrangler |
| Remote D1 | No pending migrations through `0056` |
| Local D1 | Pending `0053`–`0056` (dev only) |
| `PRESENCE_WEBSITE_ROLLOUT` | `internal` (not broader than expected) |
| Social connectors | All `disabled` |
| `PRESENCE_DIGEST_ROLLOUT` | `disabled` (notifications off) |
| Crons | `17 */6 * * *`, `0 4 * * *`, `0 5 * * MON` |
| Tests | 1245 passed (post-integration) |
| Typecheck / build | Passed |
| D1 backup validator | OK (dry-run) |
| Production `/api/health` | OK |
| Worker deployment (latest listed) | `1f9ba087-50db-42a5-8c16-6c8556fbbd0c` (2026-06-24 secret change); runtime commit not exposed by health endpoint |

## Rollout states

| State | Website behavior |
|-------|------------------|
| `disabled` | Nav hidden; all gates closed |
| `internal` | `PRESENCE_INTERNAL_WORKSPACE_ID` secret match only |
| `pilot` | D1 `presence_pilot_workspace` hashed allowlist |
| `ga` | All workspaces (plan-gated) |

**Never in git:** raw workspace user ids, customer URLs, secrets.

## Deploy sequence (when approved)

1. Merge PR with `SAFE_DEPLOY_APPROVED=pr`
2. Apply `0057` + `0058` remote D1 first (`SAFE_DEPLOY_APPROVED=d1`)
3. Deploy with `PRESENCE_WEBSITE_ROLLOUT=internal`
4. Internal canary observation (3+ sync cycles)
5. Owner enrolls pilot workspace via ops tooling (hashed row in D1)
6. Set `PRESENCE_WEBSITE_ROLLOUT=pilot` only after security + release reviewer sign-off

## Rollback

| Trigger | Action |
|---------|--------|
| Pilot data/sync issues | `PRESENCE_WEBSITE_ROLLOUT=internal` |
| SSRF / cross-workspace / security | `PRESENCE_WEBSITE_ROLLOUT=disabled` |

---

## Numbered report (47 items)

1. Main hash recorded: `7776eb3`
2. Origin/main in sync: yes
3. PR #240 merged: yes
4. PR #241 merged: yes
5. Remote D1 through 0056: applied
6. New migration 0057 pilot allowlist: added (pending apply)
7. New migration 0058 sync integrity: added (pending apply)
8. Rollout not broader than internal pre-PR: confirmed
9. Social connectors disabled: confirmed
10. Digest rollout disabled: confirmed
11. Tests pass at baseline: yes (1236)
12. Build passes at baseline: yes
13. Safe-deploy policy honored: yes (no bypass)
14. Pre-rollout patch saved: `../pre-presence-pilot-rollout.patch` (empty — clean tree)
15. Pilot state parser in access gates: yes
16. Pilot D1 allowlist (hashed): `presence_pilot_workspace`
17. No workspace IDs in git: enforced
18. Internal workspace secret path: `PRESENCE_INTERNAL_WORKSPACE_ID`
19. OAuth state secret required: `PRESENCE_OAUTH_STATE_SECRET`
20. Content revision tracking: `presence_item.revision` + `presence_item_revision`
21. Tombstone support: existing + reconcile on complete feed snapshot
22. Post-poll reconciliation: `reconcilePresenceItemsAfterPoll`
23. Sync cycle counter in poll cursor: `syncCycleCount`
24. Batch polling respects rollout gates: yes
25. Crawl feed candidate budget: `MAX_FEED_CANDIDATE_FETCHES=6`
26. Robots before fetch: existing (RFC 9309)
27. SSRF safe fetch: existing (`presenceSafeFetch`)
28. Feed completeSnapshot flag: yes
29. Coverage label UX copy: `presence-display.ts`
30. Pilot/internal banner in UI: yes
31. Digest notifications off by default: `PRESENCE_DIGEST_ROLLOUT=disabled`
32. Evidence top-ups do not unlock presence: unchanged (false)
33. Website canary script: `npm run canary:presence`
34. Pilot canary script: `npm run canary:presence-pilot`
35. Pilot runbook: `docs/presence-pilot-runbook.md`
36. Incident runbook: `docs/presence-incident-runbook.md`
37. Architecture doc: update pending (Phase 13)
38. Launch-hardening doc: update pending (Phase 13)
39. Security red team: see verdict below
40. Release reviewer: see verdict below
41. Integration branch: `cursor/presence-pilot-rollout-20260624`
42. Workstream branches: logical ownership above (merged into integration)
43. PR title: `feat(presence): promote website tracking to controlled pilot`
44. Deploy approval gate: `SAFE_DEPLOY_APPROVED=pr` required
45. Schema-first deploy: required for 0057/0058
46. Approved pilot workspace in prod: **not enrolled** (owner action)
47. Final verdict: see below

---

## Security red team (read-only)

| Area | Severity | Status |
|------|----------|--------|
| SSRF (website fetch) | — | PASS — `resolvePublicHttpUrl` + bounded response |
| OAuth replay | — | PASS — HMAC transactions + atomic consume |
| Robots bypass | — | PASS — fail-closed on robots errors |
| Rollout bypass | — | PASS — async D1 pilot check; batch skips non-allowed workspaces |
| XSS (presence UI) | — | PASS — React default escaping; external links use `rel="noreferrer"` |
| Secrets in repo | — | PASS — no workspace ids committed |
| Cross-workspace access | — | PASS — all queries scoped by `user_id` |

**Blockers:** none (critical/high)

## Release reviewer

| Gate | Status |
|------|--------|
| D1 schema for pilot | Ready (0057/0058) |
| 3+ live sync cycles | **Pending** — requires owner internal workspace + deploy |
| Pilot workspace enrolled | **No** |
| Canary scripts | Ready |

**Verdict:** APPROVE AFTER FIXES — ship PR at `internal`; pilot flip blocked until enrolled workspace + 3 observed cycles

## Final verdict

**INTERNAL OBSERVATION COMPLETE — PILOT WORKSPACE REQUIRED**

PR integration complete on `cursor/presence-pilot-rollout-20260624`. Deploy at `internal` after review. Do not set `PRESENCE_WEBSITE_ROLLOUT=pilot` until owner enrolls a hashed pilot row and post-deploy observation confirms 3+ sync cycles.
