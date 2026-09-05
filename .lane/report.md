# Lane reports

Lane reports are appended below (each section is kept verbatim).

- [MONEY silent-failure remediation](#money-silent-failure-remediation) — PR #445, branch `fix/silent-fixmoney` (landed on `main`)
- [Silent-failure observability remediation](#silent-failure-observability-remediation) — PR #447, branch `fix/silent-fixobserve`

---
# MONEY silent-failure remediation

**Status: remediated; terminal PR checks green; not merged.** Product findings
from the BLOCK review and the follow-up crgate pass are cause-fixed with
regressions. This report is not merge approval: Greptile credit exhaustion and
Bugbot usage limits prevented findings from those services. Do not merge from
this worktree.

Branch: `fix/silent-fixobserve`
Base: `origin/main` at `46fe111`
Pull request: https://github.com/nish3451/0509/pull/447

## Outcome

This lane remediates C1, C2, M2, M4, M5, M6 and content-sanity F1–F4. C6 is
partially closed without inventing a credential: failed email pages are
recorded but never activate the successful-page throttle, so each later
failure retries. No Telegram/Hermes webhook secret or config key exists in
`AppEnv`, `wrangler.jsonc`, or the repository, so the independent secondary
channel is proposed below rather than silently simulated.

## Failing-first evidence and fixes

The confirmed verifier artifacts are the failing-first baseline, per the lane
brief. I used their source probes and defect-locking tests rather than
temporarily restoring unsafe behavior.

| Finding | Confirmed pre-fix probe | Cause-level remediation and regression proof |
|---|---|---|
| C1 | `SILENT-FAILURE-AUDIT.md:61-69`: all observation begins inside an invoked scheduled handler; the only reader was release soak. | Added a separate hourly `13 * * * *` deadline reader over `release_scheduled_observation`, with cadence-specific freshness limits and an operator-email alert. Migration 0072 stores an allowlisted per-cron activation baseline, so a newly enabled schedule gets one honest cadence before “never” becomes overdue; an unavailable baseline fails the health read instead of looking healthy. Once established, that baseline is never renewed merely because observation retention removed the last row, so a cron cannot silently regain grace by remaining absent. The migration also indexes `(cron, scheduled_at)` for the freshness aggregate, and its schema test proves all configured deadlines are accepted while unsupported crons are rejected. A separate regression asserts every configured workload cron has a deadline, excluding only the heartbeat. The heartbeat still drains billing-email recovery without passing its unsupported cron into release-soak observation. `scheduled-observation-health.server.test.ts`; heartbeat routing and rejection paging in `worker-scheduled-handler.test.ts`. |
| C2 | Audit lines 71-84 and verifier probes showed fulfilled degraded results had no active consumer; redispatch failures were absent from the fanout result. | Degraded observation results actively page, genuine monthly recap failures page while intentional no-op skips and concurrent `claim_lost` outcomes are tracked separately, redispatch failures are returned/persisted, and inline/digest failures enter the dedicated operational risk mail without a second generic scheduled-monitoring page. Monthly recap reuses the existing lazy delivery-target provisioner, so a paid user with a verified account email is not silently skipped merely because no workspace target row exists yet. The resolver checks exact-address suppression across every target scope before provisioning, treats unusable workspace targets as authoritative, and does not mistake a watchlist target for workspace-digest authorization. A recap dispatch-gate rejection is classified as `claim_lost` only when its durable delivery attempt proves another owner advanced; otherwise it remains a failed recipient, logs a bounded diagnostic, and pages. Expected duplicate scheduled claims are `no_work`; weekly and customer-risk email replays are `no_work` only when their durable attempts prove prior acceptance, while delivery/state-lookup failures remain degraded. Mixed budget, dispatch, inline, and digest failures retain every active category in their idempotency key. Degraded-page delivery failure is logged separately and cannot relabel an already-persisted observation failure. Migration 0071 expands the metrics allowlist. `release-scheduled-observation.server.test.ts`, `monthly-recap.test.ts`, `delivery.server.test.ts`, `scheduled-observation-health.server.test.ts`, and worker tests cover the active consumers. |
| C6 | Audit lines 116-124 plus the old cron-alert test explicitly required a false email send to suppress the next attempt for six hours. | Only `operator_alert_sent` rows throttle and increment the successful-page count. A first failed page keeps one durable `operator_alert_not_sent` fact with `alert_count=0`, does not throttle, and every later failure retries the channel. If a rejected page follows an earlier accepted page, migration 0073 preserves the accepted `last_alerted_at`/`alert_count` throttle evidence while `last_failed_at`/`failed_count` record the newer channel failure; the diagnostic failure counter saturates at 1,000,000 instead of growing without bound. The migration moves counts from legacy `operator_alert_not_sent` rows into failure evidence and resets their false accepted-page count; runtime conflict handling enforces the same invariant. `cron-failure-alert.server.test.ts`, `cron-failure-alert-migration.test.ts`, and the strict release fixture prove upgrade, retry, and both orderings. |
| M2 | Audit lines 166-172: the one-shot Free activation path ended in an empty catch and later scans never retried. | Later successful Free scans re-enter the existing idempotent activation claim; accepted sends remain deduplicated and failures actively page. Before claiming, the sender resolves or lazily provisions a validated, opted-in workspace target for the verified account email, preserves account-wide suppression, and attaches that target ID so the production customer dispatch gate can advance. Provisioning uses one D1 `INSERT … SELECT … WHERE NOT EXISTS` statement over account-wide exact-address suppression; an unsubscribe that wins blocks the insert, while an unsubscribe that follows suppresses the inserted row before the unchanged dispatch CAS can advance. Digest, alert, presence-digest, and activation lazy provisioning all use that atomic primitive. Target lookup/provisioning failure fails closed and pages instead of calling the provider. `data.server.test.ts`, `free-activation-observability.test.ts`, `welcome-activation-emails.test.ts`, and the full monitoring/delivery suite. |
| M4 | Audit lines 182-188: the board loader catch returned an all-zero window with no degradation flag. | Loader returns `captureWindowDegraded`; populated boards show a partial-data notice rather than believable zeros. Empty boards do not get competitor-specific wording. `watchlists.route.test.ts`. |
| M5 | Audit lines 190-196: memory failures became `[]`; report-load/helper failures appeared as revoked/absent approvals, with an old test expecting `{}`. | Memory and approval-read failures are visibly labeled. Saved approvals remain in the response during transient/helper unavailability, while readiness is fail-closed as “unavailable” until refresh. `clients.route.test.ts`. |
| M6 | Audit lines 198-204: a later Meta page exception broke the loop and returned page 1 as if complete. | Retained results now carry `discoveryStatus: healthy` plus a distinct `discoveryPartial: true`, a provider-appropriate failure class, a partial summary and retry cursor. Opaque Meta API failures use the provider-neutral `provider_unavailable` class rather than the browser taxonomy; migration 0074 preserves both discovery evidence stores and their indexes while expanding the D1 allowlist. The new class explicitly retains the prior five-minute outage backoff instead of silently falling through to the two-minute public-search default. That distinction keeps already-fresh page-one results from being mislabeled as stale/delayed while the UI explicitly says “Fresh partial result” and announces that additional results could not load. Partial exact-domain pages also qualify definitive zero-verification headlines and facts as “loaded so far.” The resolver records the failed fetch, preserves the provider’s prior successful timestamp, does not cache the partial response, and marks provider state partial so a successful first page cannot globally cool down unrelated searches. Operator rows and provider state explicitly label partial discovery, including the later-page failure class. Launch readiness excludes partial attempts from complete-result success-rate denominators, reports their own rate, and blocks separately when that rate exceeds 5%, so partial data is neither counted as full failure nor allowed to look healthy. `ad-source.test.ts`, `discovery-failure-class-migration.test.ts`, `search-answer.test.ts`, `search-load-more.test.ts`, `meta-ads-readiness.test.ts`, and `ops.route.test.ts`. |
| F1 | `CONTENT-SANITY-SWEEP.md:25-34`; `report-view.test.ts` locked “we could not read this one” into URL/language fields. | URL absence is `none stored`; language absence is `Not detected`; malformed and non-HTTP landing values are treated as missing rather than leaked as raw text. Report evidence links are real 44px phone targets implemented through the repository’s shared CSS layer. |
| F2 | Content sweep lines 36-44: instant Before/Now appeared with no capture clocks. | Before/Now renders only with two real, valid, ordered capture timestamps, and each pane names its capture time. The evaluator now propagates proof capture clocks from the current and previous captures; missing, unparsable, or non-chronological clocks fall back to a complete honest “comparison is not shown because capture times were unavailable or invalid” sentence in both HTML and text-only delivery copy. `watch-event-evaluator.test.ts`, `delivery.server.test.ts`, and the email gallery cover both paths. |
| F3 | Content sweep lines 46-54: scan-trouble mail claimed retries were already running. | Copy now promises only the next scheduled check. `digest-email.test.ts`. |
| F4 | Content sweep lines 56-65: canonical D1 ad columns existed but sparse/stale `raw_json` hid linked report fields. | `listAdsByIds` selects and hydrates every canonical column, with non-null SQL values authoritative over conflicting raw JSON and raw JSON retained when a legacy nullable D1 column is `NULL` or absent, including secondary body and first/last-seen clocks. `data.server.test.ts` covers both directions. |

## C6 secondary-channel proposal

Add an operator-only secret named `OPERATOR_HERMES_WEBHOOK_URL`, configured
with `wrangler secret put`, and post a bounded signed event containing only the
task key, failure category, UTC time, deployment/version metadata, and a log
lookup hint. Route Hermes to Telegram. The webhook attempt needs its own
durable result and short timeout; it must not include raw exceptions, customer
data, provider responses, or the webhook value. Email and Hermes should be
attempted independently, and successful throttling should require at least one
accepted channel. Until that secret exists, this lane keeps email failures
retryable and durably visible instead of pretending a second page occurred.

## Verification

| Gate | Result |
|---|---|
| Lock-wrapped `npm ci` | Passed on remediation tip; 291 packages added / 292 audited, 0 vulnerabilities |
| Focused regression suites | Passed; BLOCK-remediation suite 4 files, 30/30; crgate follow-up suite 8 files, 161/161; terminal provider/partial suite 3 files, 94/94; final activation/search/migration suite 5 files, 108/108; alert suppression suite 1 file, 26/26 |
| Lock-wrapped full Vitest | Passed on final remediation source; **389** files, **4205/4205** tests |
| Lock-wrapped typecheck | Passed on final remediation source; Wrangler typegen, React Router typegen, `tsc -b` |
| Full Gate B | Deterministic final artifact below is the source of truth; handoff is allowed only when its terminal fields are strict/pass with 73 passed entries |
| `git diff --check` | Passed |
| `sgscan` | Passed on the final diff; exit 0, no new security findings |
| CodeRabbit local (`crgate`) | Initial remediation tip: 8 findings (3 major / 5 minor), all actionable product findings fixed with regressions. A later 5-finding consolidated set was fixed at cause. The terminal post-fix pass produced 2 minor items: explicit stale-partial reset coverage was added, while its report warning was rejected after the actual lock-wrapped typecheck and full Vitest completed successfully (see follow-up tables). |
| CodeRabbit PR | The initial 4 actionable inline findings were verified and fixed (shared CSS, D1 NULL fallback, failed-page count zero, failure-mode-specific alert keys). A later review posted one actionable dispatch-gate diagnostic and identified the verified-account-email fallback plus health-query index outside the narrow diff range; all three were verified and fixed. The terminal review found that the operator's partial-result label hid the retained failure class; its regression failed first and the rendering now preserves both the partial status and cause. A historical outside-diff major found during the final audit was also fixed: alert target reuse now honors account-wide exact-address suppression before delivery. A post-push Codex PR review then found that reclaiming a pre-target activation failure left `delivery_target_id=NULL`; the generic reclaim CAS now attaches only a missing current target before dispatch. The docstring warning and broad client-route extraction request are repository-wide/out-of-lane maintainability work, not correctness findings in this candidate. |
| Greptile PR review | Unavailable: `nish3451 has reached the 50-credit limit for trial accounts`; no inline or general code findings were produced |
| Cross-model adversarial review | BLOCK review (`pr447-REVIEW-VERDICT.md`) findings 1–3 fixed at cause. Earlier Codex-engine passes also found valid edge cases in recap dispatch ownership, retention grace, global unsubscribe preservation, operator partial visibility, partial-result readiness denominators, workspace/watchlist delivery scope, idempotent customer-risk replays, legacy C6 count migration, the production Free-activation dispatch target, lazy-provision/unsubscribe atomicity, and fresh-partial presentation. The terminal exact-candidate pass found two further P2s: opaque Meta API errors still used a browser class, and one partial exact-domain path retained a definitive zero-verification headline. Both failed first and were fixed at cause. The follow-up delta review found one P3 backoff regression; it also failed first and the provider-neutral class now retains the established five-minute cooldown. The exact eight-file Claude pass accepted no actionable findings at 0.85, and the final alert-suppression delta passed a separate exact review at 0.90. |
| `bugbot-gate status` | `ALLOW BUGBOT` / `risk: high` for the terminal code fingerprint; one run was triggered and marked. Cursor returned its expected usage-limit result, so no Bugbot findings were produced. |

### PR CI terminal result

Historical GitHub run `30545966908` retained a Vitest worker after every test
file passed because its merge ref contained the older deploy-window shim
recursion described below. The owning lane subsequently repaired that shared
runner path. On remediation code tip `374570f`, exact-head run `30583993791`
passed install, build, full test, and typecheck in 3m3s; Gitleaks run
`30583993799` and backup-tool validation run `30583993779` also passed.

The historical merge ref included `origin/main` commit `e0ed012` (#440), which
was newer than this lane's `46fe111` base and added the deploy-window
compatibility tests. On that old CI run, `command -v flock` resolved to the
installed `/home/nish/.local/bin/flock` compatibility shim and its fd-lock
probe executed the shim as its own “real” flock indefinitely:

`deploy-window-lock.sh -> /home/nish/.local/bin/flock -> deploy-window-lock.sh`

The second historical attempt reproduced that recursion under
`tests/deploy-window-lock.test.ts`; no candidate assertion failed. This lane
correctly did not edit #440's lock/CI ownership. The green terminal run proves
the external blocker is now cleared without gate weakening or cross-lane edits.

The GitHub-installed Bugbot hook ran independently of this lane command and returned a neutral usage-limit result. The lane did not invoke Bugbot directly and followed the `bugbot-gate status` decision above.

---
# Deploy restore-evidence self-generation remediation

**Status: implemented; full test suite and typecheck green; PR open, not merged.**

Branch: `fix/deploy-restore-evidence-self-generate`
Base: `origin/main` at `b5bf3ce7`
Pull request: https://github.com/nish3451/0509/pull/545

## Problem

Deploy production failed 23 of the last 40 runs (runs 31278146322, 31224627211,
31275731092, ...) with `##[error]No valid pre-generated restore evidence is
available. Run the D1 remote restore evidence workflow in its recovery window,
then rerun this deploy.` The pinned-SHA restore-evidence gate accepted only
evidence artifacts produced by the separate `D1 remote restore evidence`
workflow (nightly 20:47 UTC drill or manual dispatch), which covers a single
main SHA per run. Every deploy of a migration-bearing or restore-critical main
commit between drills failed with `remote_restore_candidate_mismatch` until a
separate workflow ran at that exact SHA (verified in run logs: failures at
19:58/20:57 unblocked only after the 20:58 drill dispatch uploaded evidence).

## Fix

The exact-SHA safety gate is unchanged; the deploy no longer depends on a
separate workflow having run first.

- `scripts/ci-prepare-remote-restore-evidence.sh`: missing/stale/corrupt/
  non-matching evidence now reports `restore_evidence_available=false` and
  exits 0 instead of hard-failing; only tooling infrastructure failures
  (artifact lookup/download/verifier, exit 2) still stop the deploy. Packaging
  failures fall back to fresh generation.
- `.github/workflows/deploy-production.yml`: new `generate_restore_evidence`
  job runs the same drill as the nightly workflow (fresh GitHub-hosted runner,
  protected `production` environment, same approval markers, provider-lane
  acquire/release, archive/upload) at the exact pinned SHA; new
  `cleanup_restore_evidence` job deletes every run-scoped scratch database
  including from a hard-killed generation attempt; the protected `deploy` job
  proceeds only after the generated evidence passes the same exact verifier
  and cleanup succeeded. Fast path (verified pre-generated artifact) skips
  both new jobs.

## Verification

- Full Vitest: 421 files, 4772/4772 passed.
- `npm run typecheck` (wrangler typegen + react-router typegen + tsc -b): passed.
- `git diff --check`: clean.
- Behavioral tests now lock: missing/corrupt/expired/oversized/publish-failure
  evidence exits 0 with `restore_evidence_available=false` and no archive;
  infrastructure failures still exit 2; workflow tests lock the
  generate/cleanup wiring and deploy gating.

## Follow-up: direct-needs wiring defect found and fixed

Post-push review found one genuine wiring defect in the original workflow
change. `prepare_remote_restore_evidence` declared its `backup_proof_status`
output as `${{ needs.authorize_release.outputs.backup_proof_status }}` while
its `needs` list contained only `pin_candidate`. GitHub Actions exposes only
direct dependencies in a job's `needs` context: an empirical probe workflow
(job c needing only job b, reading `needs.a.outputs.val`) ran on GitHub and
printed `transitive_need_a=` (empty), while the direct reference printed
`direct_need_b=required`. A transitive reference therefore evaluates to an
empty string at runtime, which would have made the new
`generate_restore_evidence` / `cleanup_restore_evidence` jobs silently skip
their `backup_proof_status == 'required'` conditions and left the missing-
evidence deploy hard-failing at the deploy job's own verification — the exact
failure this lane removes.

Fix: the output now reads `${{ needs.pin_candidate.outputs.backup_proof_status }}`
(`pin_candidate` is a declared direct dependency and carries the identical
value from `authorize_release`). A regression test now parses
`deploy-production.yml` and asserts every `needs.<job>.` reference in every
job names a declared direct dependency; it failed first against the broken
wiring (`prepare_remote_restore_evidence ... undeclared: authorize_release`)
and passes on the fix.

Verification on this tip: full Vitest 421 files, 4773/4773 passed (new
regression included); `npm run typecheck` passed; `git diff --check` clean.

---
# Home slow-rendered-load dogfood verification (no code change required)

**Status: already resolved by PR #542; this lane records the evidence only.**

Branch: `report/lane1-home-load-already-resolved`
Base: `origin/main` at `90147b9b`

## Item

- [dogfood `c99ff5d9b87b`] Slow rendered load on home — "Rendered audit reached
  network idle in 5136ms", page scope: home
  (`runs/20260808T074205Z-msk2fl3n.json`).

## Verdict

No code change was warranted. The root cause of the slow rendered load — the
home page eagerly fetching `/api/pricing-preview` (a Dodo checkout-preview call
that can take seconds) on mount, keeping the rendered document from reaching
network idle — was already fixed, merged, and deployed:

- PR #542 / commit `b7078ef1` (`fix/home-slow-rendered-load`), merged into
  `origin/main`, is the first content change to `app/routes/marketing.tsx` in
  the current `main` history and is an ancestor of `origin/main` HEAD
  (`90147b9b`).
- The loader returns `pricingPreview: noPricingPreview` (no server fetch), and
  the client only fetches `/api/pricing-preview` once the `#pricing` section
  approaches the viewport (with a 10s safety-net timer), so the initial
  document load settles fast. The commit message and a source comment both cite
  this exact dogfood observation (`c99ff5d9b87b: 5136ms to network idle`).
- Regression test `tests/marketing-pricing-fetch.test.tsx` locks the deferred
  behavior and passes on this branch (4/4 in `marketing-pricing-fetch`).

## Live verification (2026-08-09)

Loaded `https://0509.io/` in a real browser:

- `performance.getEntriesByType('resource')` on initial load contains NO
  `/api/pricing-preview` request — the eager fetch is gone from production.
- Rendered content confirmed (`h1`, `#pricing` section present).
- `performance.timing.domContentLoadedEventEnd - navigationStart` ≈ 1360ms,
  i.e. a healthy, fast rendered load far from the 5136ms recorded in the
  original dogfood observation. Slowest resources were the non-blocking
  favicon/apple-touch-icon and the third-party siterep widget script.

## Checks

- Focused regression `npx vitest run tests/marketing-pricing-fetch.test.tsx`: 1
  file, 4/4 passed.
- `git diff --check`: clean (markdown-only change; no product code touched).

---
# Homepage top-nav signup CTA + magic-link next-step verification (no code change required)

**Status: already resolved by PR #554 (follow-up #558); this lane records the evidence only.**

Branch: `report/lane1-nav-signup-cta-already-resolved`
Base: `origin/main` at `0508dae0`

## Item

- [ ] Homepage top nav has no signup CTA; signup is below-fold or an extra hop
  via Sign in, and the magic-link step is [opaque/unclear] (lane 1 checklist
  item, packet text truncated after "the magic-link step is o…").

## Verdict

No code change was warranted. Both halves of the item — a top-nav signup CTA
that reaches `/auth/signup` directly, and plain-words next-step guidance for
the signup magic-link flow — were already implemented, merged to `main`, and
are live in production:

- **Top-nav signup CTA**: PR #554 / commit `49ed0e28`
  (`ux(nav): give anonymous visitors a Sign up CTA in the public header`),
  merged into `origin/main`, is an ancestor of the current `main` HEAD
  (`0508dae0`). `MarketingNav` (the one header shared by the homepage, `/ads/*`
  brand pages, compare pages, and the legal/doc shell) now renders a "Sign up"
  pill CTA → `/auth/signup` beside "Sign in" and "Open app" — above the fold on
  every public surface, no scrolling and no detour through Sign in.
- **Magic-link next-step guidance**: the same PR (#554) rewrote the
  signup-mode `AuthForm` copy: pre-submit it states the next step ("We'll send
  a setup link to that inbox — open it to verify, then add a competitor and
  start tracking"), and the post-send recovery state adds timing + spam/
  promotions guidance ("It usually arrives within a minute. If it's slow, check
  your spam and promotions folders before resending"). Login-mode copy is
  untouched (locked by tests).
- **Mobile follow-up**: PR #558 / commit `834da2df`
  (`fix(nav): stop Gate-B mobile fold fail from three-action header wrap`)
  is also in `main`, so the three-action header keeps ≥44px touch targets with
  no horizontal overflow at 320–1024px.

## Code evidence on this tip

- `app/components/marketing-nav.tsx` — "Sign up" pill (`ld-nav-pill`) →
  `/auth/signup` in `.ld-nav-actions`, with "Open app" demoted to the same
  text-link treatment as "Sign in".
- `app/components/auth-form.tsx` — signup-mode pre-submit next-step copy
  (lines 68–70) and post-send recovery guidance (lines 78–83); login copy
  unchanged.
- `app/app.css` — `.ld-nav-pill` styling for both `.f9-home` and
  `.f9-legal-page`; ≤860px nav grid treatment from #554/#558.
- Regression tests on `main`: `tests/marketing-nav.test.ts` and
  `tests/auth-form-signup-guidance.test.ts` (5 tests covering pre-submit
  next-step copy, post-send recovery copy, and login-mode isolation).

## Live verification (2026-08-09)

Loaded `https://0509.io/` in a real browser (Camoufox):

- Account navigation in the top header renders all three actions above the
  fold: `Sign in` → `/auth/login`, `Open app` → `/app`, and `Sign up` →
  `/auth/signup` (pill).
- Section CTAs also point straight at `/auth/signup` (no `Sign in` detour).
- Loaded `https://0509.io/auth/signup`: heading "Verify your work email to
  start.", pre-submit copy "Use a work email. We'll send a setup link to that
  inbox — open it to verify, then add a competitor and start tracking.", submit
  button "Send setup link" (live post-send state not exercised to avoid sending
  a real production magic-link email; it is locked by the passing regression
  tests above).

## Checks

- Focused regressions `npx vitest run tests/marketing-nav.test.ts
  tests/auth-form-signup-guidance.test.ts`: 2 files, 8/8 passed on this tip.
- `git diff --check`: clean (markdown-only change; no product code touched).

---
# AI Answer Readiness: rendered pages lack extractable detail — dogfood 69e1b4be47bf

**Status: root-cause resolution verified against the in-flight fix (PR #563);
item closes on merge + deploy + same-engine dogfood rerun. No duplicate PR opened.**

Branch: `fix/ai-answer-readiness-content-depth`
Base: `origin/main` at `6f1026f3`
Pull request: https://github.com/nish3451/0509/pull/566

## Item

- [dogfood `69e1b4be47bf`] AI Answer Readiness: rendered pages lack extractable
  detail (`ai-answer-readiness-content-depth`, warning) from
  `runs/20260808T074205Z-msk2fl3n.json`; page scope `/search`.
- Ledger-observed: "2 rendered pages have fewer than 250 words, led by /search
  with 207 words."

## Verdict

The finding is **live today** and its root cause is the same thin rendered
content that dogfood `694ddbd68e95` covers on the same two pages (`/search` and
`/auth/login`). The `ai-answer-readiness-content-depth` check is fed by the
same `rendered.wordCount` field as the thin-content finding, and its fix is
identical in substance: visible, page-specific content lifting both pages over
the engine's 250-word floor.

That fix is already in flight as PR #563 (`fix/search-thin-content`, CI green,
mergeable, merge state CLEAN) with regression tests. The 0509 improvement-loop
backlog note for the sibling item explicitly directs lanes **not to open a
second thin-content PR**, so this lane made no duplicate code change. Instead it
verified, with the exact engine the dogfood job wraps, that the in-flight fix
clears *this* finding, and records the evidence here.

## Verification (same engine the dogfood job wraps)

Engine: `proof-seo/server/audit/engine.js` (checkout
`/home/nish/workspaces/products/proof-seo`, the registry's SEO Fix Kit path),
`auditUrl(url, { maxPages: 6, pageSpeed: false })` — identical options to the
dogfood pipeline.

- **Live production, 2026-08-09 ~14:18Z (before fix):** finding present —
  `ai-answer-readiness-content-depth` / "AI Answer Readiness: rendered pages
  lack extractable detail", evidence "2 rendered pages have fewer than 250
  words, led by /search with 207 words."; `contentDepth.status =
  needs_repair`; lowContentPages = `/search` (207 rendered words) and
  `/auth/login` (193 rendered words); readinessScore 72, repairOpportunityCount 1.
- **Fixed code (PR #563 content, `fix/search-thin-content`), local dev server,
  2026-08-09 ~14:28Z:** `/search` renders **398 words**; `contentDepth.status =
  passed`, `lowContentPages = []`, `pagesWithEnoughText = 5`; **zero**
  AI-Answer-Readiness findings on the page.
- **`/auth/login`** cannot be crawled locally (auth-route rate limiter is
  fail-closed: live local probe returns 503 `rate_limit_unavailable`, same as
  the 694ddbd68e95 lane recorded), so it is verified deterministically: live
  baseline 193 rendered words + 87 unconditional visible tokens added by the
  login story-column proof row and one-time-link note (counted from the
  `auth.login.tsx` diff) → **~280 rendered words ≥ 250**.

Both pages therefore satisfy the finding's acceptance ("the page has at least
250 rendered words with visible, page-specific detail") once PR #563's content
is deployed. The dogfood job auto-resolves the fingerprint on the next complete
0509 audit after the deploy; no product code change is warranted from this lane.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

---
# Manual SaaSHub listing preparation

**Status: prepared; PR open, not merged, not submitted to SaaSHub.**

Branch: `docs/saashub-listing`
Base: `origin/main` at `5e682868`
Pull request: https://github.com/nish3451/0509/pull/574

## Item

- [ ] Prepare a manual SaaSHub listing for Five to Nine [scout 2026-08-09,
  risk: green] [traction] [unreviewed-by-grok]

## Outcome

`docs/saashub-listing.md` contains the complete, paste-ready SaaSHub
submission: form facts, acceptance-criteria check, category picks, verified
competitor picks, tagline + description + features copy, media guidance,
honesty constraints, and the owner submission checklist. The actual form
submission is an owner action (requires a SaaSHub account and a `@0509.io`
mailbox for product verification); nothing in the directory can be submitted
from the repo.

## Research grounding (2026-08-10, live checks)

- SaaSHub submission guidelines fetched from `/services/submit`: products
  must be released, English, on an owned domain, not agencies/waitlists;
  categories and competitors are requested during submission; missing
  competitors drops the submission to the bottom of the queue; domain-email
  verification raises priority.
- Category pages verified: Advertising, Marketing Platform, Website
  Monitoring, Marketing Analytics (all return real SaaSHub category pages).
- Competitor slugs verified live: AdSpyder, PowerAdSpy, AdPlexity,
  MagicBrief, BigSpy, Brand24, Mention, AWARIO, SpyFu, AdCreative.ai all
  return real product pages; `minea`, `foreplay`, `swipewell` return 404 and
  are documented as not-existing.
- Listing copy mirrors already-public homepage claims (`app/routes/marketing.tsx`
  headline/hero sentence) and plan facts from `docs/plan-catalog.md` +
  README; honesty constraints (no WhatsApp/Slack, no hardcoded currency, no
  unlimited-monitoring, no `.in`) are encoded in the doc.

## Checks

- `git diff --check`: clean (markdown-only change; no product code touched).
