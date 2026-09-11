# CI Gates Ledger

Decision (Nish, 2026-09-11, issue #2994): "only keep the relevant ones duhh."

This file is the reference every time someone wants to **add** a gate: a new gate
needs a row here with a **named incident** (issue link) or a **standing rule**
(vault `global-standing-rules.md`) behind it. "It seemed prudent" is DELETE.

Standing rules that earn a gate (cited per row below):

- **R1 restore-evidence** — restore evidence must exist and be proven before any
  migration/deploy mutation (vault global-standing-rules.md).
- **R2 secret scanning** — no secret reaches a public repo or a runner log.
- **R3 nothing-fails-silently** — every scheduled job monitors its own freshness
  or has a monitor that does.
- **R4 reversibility-over-gating** — a merge must be as undoable as a deploy
  (Nish, canonical; enforced by auto-revert).
- **R5 independent verifier integrity** — required verifiers may not self-certify
  their own definitions (sol-sweep finding; Nish 2026-08-25 "no agent runs amok
  and bypasses our quality gates").

## Target shape

- **One required PR job** (`ci.yml`, path-gated where the check is path-scoped):
  typecheck + node tests + build + Gitleaks + Dependabot-critical + the
  verifier-integrity claim check. One `codex-node-checks` context, not four.
- **One nightly canary job** (provider / billing / proof / email canaries, plus
  the SEO/meta canaries) — scheduled, non-blocking, monitored for staleness (R3).
- **Deploy production kept, trimmed** to the steps that have incidents behind
  them (R1);
- **One admin attestation path, not two** (or none on non-workflow diffs).
- Everything else: visibility-only or deleted, with the deleting PR carrying its
  ledger row.

## Baseline (BEFORE numbers, measured 2026-09-11)

- Median PR `ci.yml` wall-clock: **4.2 min** (n=134 recent pull_request runs),
  p90 **16.8 min**.
- PR-blocking contexts observed on CI: `Gitleaks`, `codex-node-checks`,
  `codex-node-checks-shard-2`, `codex-node-checks-shard-3`,
  `codex-node-checks-shard-4`, `dependabot-critical-check` — **6 required
  contexts** produced by PR CI, plus integrity gates compiled in on top
  (`required-verifier-integrity`, `gate-integrity`).
- 26 workflow files, 5,093 lines of workflow YAML; `deploy-production.yml` alone
  728 lines / 9 jobs.

## The table

| Gate / workflow | What it blocks | Justification (named incident / rule) | Cost per PR | Disposition |
| --- | --- | --- | --- | --- |
| `ci.yml` `codex-node-checks` (+3 shards) | Untested code reaching main | Standing: nothing merges untested | ~4.2 min median per PR, ×4 shard overhead | **MERGE-INTO** one `codex-node-checks` required context (single job or matrix with one context name) |
| `ci.yml` `dependabot-critical-check` | Open critical Dependabot alerts on direct deps | Standing: critical dep vulns block merge | ~1 min (step-gated) | **KEEP** (in the one PR job) |
| `ci.yml` `release-proof` | Merge-group batch without Gate-B release proof | Incident #2840: batch suspiciously short carrier era | Only in merge_group | **KEEP** |
| `secret-scan.yml` (Gitleaks) | Secrets in the repo | R2 secret scanning (holding rule) | ~1 min | **KEEP** (merge into the one PR job, keep the writer/authorizer intact) |
| `required-verifier-integrity.yml` | PR touching the verifier definitions self-certifying; unverified admin bypasses | Incident: PR #694 changed both required-context producers and self-succeeded; Nish 2026-08-25 | ~1–2 min (compile + diff-owned heuristic) | **KEEP** — this is the P10-B seatbelt |
| `required-verifier-integrity.yml` `verifier-attest:` | Admin-only fast path for verifier-definition changes | Owner decision Nish 2026-08-20; head-sha-pinned so any push invalidates | Conditional | **KEEP** (sha-pinned, non-additive) |
| `gate-integrity.yml` | Gate-bypass *moves* RVI cannot see (copies, driver-step swaps) | Nish 2026-08-25 ("cover all our bases"); fleet-ops#828 / 0509#1273 prose-attest shape | ~1 min compile + diff gate | **KEEP** detector, **MERGE-INTO** `required-verifier-integrity` — one integrity workflow files both, and the second admin attestation (`gate-integrity-attest:`) is dropped; two admin attestations per push is not acceptable |
| `deploy-production.yml` (728 lines, 9 jobs) push-to-main deploy + Gate A/B/C + restore-evidence + ledger | Undeployable or unrestorable state reaching prod | R1 restore-evidence-before-migrations (incidents: scratch-restore kill #630, deploy drift 0509 .lane reports) | Runs only on main | **KEEP, TRIM** — delete steps with no incident; the audit of the ~20 named steps is the deletion batch list below |
| `preview-assert.yml` | Merge lands a diff that fails the release assertion on main | Incident 0509#1576: 9 of 120 merges auto-reverted because the assertion ran only after merge | Path-gated (PR #1580 lesson) ~5 min | **KEEP** |
| `auto-revert.yml` | Red main after merge | R4 reversibility (Nish canonical) | Runs on failure only | **KEEP** |
| `auto-merge-arm.yml` | Un-armed merges / merge-queue misuse | fleet-ops#1457, #3532 | ~1 min, PR events only | **KEEP** |
| `review-gate.yml` | Greptile review budget burn | Incident 2026-08-03: 50/month budget ran dry across 185 PRs/30d | Conditional (`review:deep` only) | **KEEP** |
| `semgrep-actionlint.yml` | Malformed/miswritten workflow + TS checks | Purpose-built for the smallest-diff rule (fork-guard authorizers); not yet a required context | ~2 min per PR | **MERGE-INTO** the one PR job as a path-gated step (`.github/**`) so it is one context, not a fourth workflow |
| `content-quality.yml` (Vale) | Prose regressions repo-wide | Incident #1728 | Full-tree Vale on every PR | **KEEP**, path-gate to `docs/**`, `.vale/**`, `app/**/*.md` |
| `quality-ratchet.yml` | Sentence-length ceiling drift | Incident #1728 | Weekly on main | **KEEP** |
| `ratchet-auto-tighten.yml` | Design-system banned-marker drift | Background: monotone ratchet purpose; separate ceiling for markers in `app/` | Weekly on main | **MERGE-INTO** `quality-ratchet.yml` — one weekly ratchet workflow, two ratchet scripts |
| `cross-browser-matrix.yml` | (nothing blocking — diagnostic) | Diagnostic only, nightly | Nightly | **KEEP** as nightly diagnostic (does not belong in the PR path) |
| `stale-unarmed-prs.yml` | Forgotten PRs drifting unarmed | fleet-ops#4146 replacement; nudge only, never closes | Daily, non-blocking | **KEEP** |
| `uptime-health.yml` | Production down unnoticed | Runtime-described: the 5-min Actions cron was never real liveness (median 63 min, 300 obs 2026-07-25..08-11); VPS systemd timer owns liveness now | 0 by default (dispatch-only) | **DELETE** the file — the 0509-liveness systemd timer is the detector; a dispatch-only workflow is dead weight (deletion PR carries this row) |
| `ads-prog-seo-canary.yml` | /ads/:domain union regression (noindex/sitemap parity) | Issue #1455 (BET 5 surface-live bet) | Nightly | **KEEP** (nightly canary row of the target shape) |
| `meta-discovery-canary.yml` | Meta discovery / full-site run liveness | Issue #2110 | Nightly | **KEEP** |
| `market-signal-snapshot.yml` | Missing daily market-signal D1 snapshot | Incident: cron OAuth expiry left it stale 5 mornings (PR #557) | Daily | **KEEP** |
| `market-signal-snapshot-age.yml` | A missed daily snapshot being silent | R3 + issue #1894 (2026-09-06 miss) | Daily | **KEEP** |
| `d1-backup-r2.yml` | No restorable D1 backup | R1 | Daily | **KEEP** |
| `d1-backup-validate.yml` | Broken backup tooling in a PR | R1 (validated tooling) | Path-gated to backup scripts/wrangler.jsonc | **KEEP** |
| `d1-remote-restore-evidence.yml` | Deploy without proved restore | R1 (#2975 per-lane concurrency fix) | On deploy cadence | **KEEP** |
| `d1-restore-proof-auto-refresh.yml` | Backup proof going stale between restores | R1 | Daily | **KEEP** — candidate to MERGE-INTO `d1-backup-r2`'s schedule; the deletion PR decides with one cron
| `finalize-production-soak.yml` | Un-halting a deploy without soak proof | Gate C (deploy-production-gate tests) | Dispatch-only post-deploy | **KEEP** |
| `backlog-console-refresh-test.yml` | Regression in automation/backlog-console/refresh.sh | Left its own file deliberately to keep the protected-verifier files untouched; hermetic, path-scoped | Disposable-path PRs | **MERGE-INTO** the one PR job as an additional path-gated job |
| `launch:readiness` npm chain | Ship-block readiness pipeline | Standing pre-launch proof; `:predeploy` variant exists | Manual | **KEEP** (script, not a gate); documenting only — do not delete |
| `legacy/` (Supabase-era reference) | Nothing (not in the build) | README: "not part of the live build" | 0 | **KEEP as archive** (marked, documented) — zero CI cost; deleting is optional cleanup |
| `.lane/reports/` (179 files) | Nothing (audit trail) | Standing: lane reports are the audit artifact for gate decisions | 0 (docs) | **KEEP**; future reports go to `archive/lane/` so the live tree stays small |
| Admin attestations `verifier-attest:` + `gate-integrity-attest:` | Admin fast-path for verifier/gate diffs | verifier-attest: Nish 2026-08-20; gate-attest: duplicate detector | Conditional | **MERGE-INTO**: one attestation marker (`verifier-attest:`) parsed by the single integrity workflow; non-workflow diffs need no attestation |

## Deletion batches (small PRs, each carries its row)

1. **DELETE `uptime-health.yml`** (row above; VPS systemd timer owns liveness).
2. **MERGE-IN**: shards→one `codex-node-checks` context; `semgrep-actionlint` +
   `backlog-console-refresh-test` → path-gated steps in the one PR job;
   `content-quality` path-gated; `ratchet-auto-tighten` → one ratchet workflow;
   integrity attest → single marker.
3. **TRIM `deploy-production.yml`**: any of the ~20 named steps that cannot name
   an incident go in this batch.

Each deletion PR must update the branch-protection required-check list in the
same PR (an orphaned required check blocks main forever — the incident the
`deploy-production-gate.test.ts` history encodes) and record the measured
**after** median PR CI wall-clock and required-check count on this ledger's
"after" table below.

Where the "after" row lands safe: the **after** table is filled by the respective
deletion PR (this unit only owns the baseline + the table + the batch issues).

## After table

Fill per deletion batch when merged:

| PR | before (median PR CI min, required contexts) | after | delta |
| --- | --- | --- | --- |
| (pending) | | | |
