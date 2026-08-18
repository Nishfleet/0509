# Lane reports

Three remediation lanes wrote evidence to this path independently. All are kept
verbatim below.

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
# Brand "is running"/owns-Meta-ads claims on visitor pages (2026-08-10 lane 10) — already resolved by PRs #550 and #561

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane10-brand-owns-ads-already-resolved`
Base: `origin/main` at `f2c583ef`

## Item

- [ ] Stop telling visitors a brand "is running" / owns Meta ads when the
  cached creatives are other advertisers selling

## Verdict

No code change was warranted. The item is already landed on `origin/main`:

- PR #550 — `159edbd8` "fix(ads): brand pages stop claiming the brand
  runs/owns ads from other advertisers", merged 2026-08-09.
- PR #561 — `6f1026f3` "fix(ads): ad wall never labels an unconfirmed
  creative with the brand name", merged 2026-08-09.
- The adjacent public `/search` "right now" promise is separately gated by
  PR #567 — `5e682868`, merged 2026-08-09.

All three are ancestors of the current `main` HEAD (`5021807e`). No later
commit touches the involved files (`app/lib/brand-page.server.ts`,
`app/routes/ads.$domain.tsx`, `app/components/ads/*`).

## Evidence on current main

The root cause was that a public `/ads/:domain` page renders ONLY from the
discovery cache, and a domain-mode cache also holds creatives from OTHER
advertisers (resellers, affiliates, sellers) whose landing pages point at the
brand's site. Before the fix, the hero headline, meta title/description,
ticker tag, closer headline, closer honesty line, and ad-wall card labels
unconditionally told visitors the brand "is running" / owns every cached ad.
The merged fix attributes every claim by per-ad ownership:

- **Ownership signal** (`adIsBrandOwned` / `countBrandOwnedAds` in
  `app/lib/brand-page.server.ts`): a creative counts as the brand's own ONLY
  on `search-v2` `verified_advertiser_domain` / `verified_entity` evidence, an
  advertiser page named with the brand's registrable domain token, or an
  advertiser page named with the brand label as a whole word. Landing-page-only
  match levels (`exact_hostname`, `registrable_domain`, `verified_alias`),
  unrelated advertiser names, blank advertiser names, and text-only matches
  NEVER count — so the page never claims the brand runs creatives it cannot
  attribute.
- **Loader** (`app/routes/ads.$domain.tsx`): exposes `brandOwnedAdCount`; every
  claim surface keys off all-owned / none-owned / mixed:
  - H1 verdict: "{Brand} is running N Meta ads right now" only when EVERY
    cached creative is the brand's own; none-owned renders "{N Meta ads are}
    pointing at {domain} right now" (fresh) or "The last check found …";
    mixed renders "{Brand} is running {k} of these N Meta ads".
  - Meta title/description and the WebPage JSON-LD: "{Brand} Facebook &
    Instagram ads" only when all-owned; otherwise "Meta ads linking to
    {domain}" with the split named (see
    `tests/ads-brand-page.route.test.ts` "never claims the brand owns ads when
    the cached creatives are other advertisers'").
  - Ticker: tags the brand only when all creatives are its own, else tags the
    domain.
  - Hero subline and closer headline/honesty line: attribute to "other
    advertisers" / "the advertisers linking to {domain}" and state exactly who
    runs what in a mixed cache.
  - Change-feed reason line is advertiser-neutral ("the advertiser is testing
    which creative wins"), since a feed row may be another advertiser's ad.
- **Ad wall** (`app/components/ads/brand-ad-wall.tsx`, PR #561): every card is
  attributed to the creative's REAL advertiser as stored in the cache; an
  unconfirmed advertiser renders "Advertiser unconfirmed" — never the page's
  brand name.
- **Freshness honesty** (adjacent, PR #567 + the route's
  `freshForLiveClaim` gate): present-tense "right now"/"live" wording appears
  only while the capture is young enough for a live claim; older captures flip
  to "was running … at the last check" / "on record".

A sweep of every visitor-facing route on this tip (`ads.$domain`, `search`,
`marketing`, `compare/*`, `docs`, `changelog`, `help`, `not-found`) found no
remaining unconditional brand-ownership claim about cached creatives — the
only "is running" instances left in `ads.$domain.tsx` are inside the
all-owned / mixed branches and the none-owned branch attributes to the
advertisers.

## Regression pins (on this tip)

- `tests/ads-brand-page.signals.test.ts` — `adIsBrandOwned` /
  `countBrandOwnedAds`: label/domain-token/v2-evidence counting, landing-only
  levels never count, unrelated sellers never count, mixed-cache counts.
- `tests/ads-brand-page.route.test.ts` — loader counts only the brand's own
  creatives as brand-owned, reports zero when every cached ad is another
  advertiser's, never claims the brand owns ads in meta title/description,
  keeps "right now" only while fresh.
- `tests/ads-brand-page.render.test.tsx` — "stops telling visitors the brand
  is running ads when the creatives are other advertisers'", "names the split
  when the cache mixes the brand's own ads with other advertisers'", "never
  labels a creative with the brand name when its advertiser is unconfirmed",
  plus JSON-LD / live-claim tense flips.
- `tests/search-live-claim.test.tsx` — the /search "right now" promise is
  pinned to proven fresh-live captures only.

## Verification on this tip (origin/main `5021807e`)

- `ads-brand-page.signals.test.ts`, `ads-brand-page.route.test.ts`,
  `ads-brand-page.render.test.tsx`, `search-live-claim.test.tsx`: 4 files,
  59/59 tests pass.
- `npm run typecheck`: exit 0.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

---
# Alert named owner + materiality reason (2026-08-11 lane 1) — already resolved by PR #571

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane1-alert-owner-materiality-already-resolved`
Base: `origin/main` at `7b618cdb`

## Item

- [ ] Add a named owner and materiality reason to every alert before
  delivery [research-desk 2026-08-08, risk: amber]

## Verdict

No code change was warranted. The item is already landed on `origin/main`:

- PR #571 — `47db20f4` "feat(alerts): named owner and materiality reason on
  every delivered alert", merged 2026-08-11 (commit date 2026-08-11 00:34
  +0530, before this worktree was created at 01:20). The resolving commit is
  an ancestor of the current `main` HEAD (`7b618cdb`), and no later commit
  touches the involved files (`app/lib/change-intelligence.ts`,
  `app/lib/delivery.server.ts`, `app/lib/digest-email.server.ts`,
  `app/lib/monitoring.server.ts`).

## Evidence on current main

The E2 alert increment (research-desk 2026-08-08) extended the briefs
accountability contract (PR #546, digest named owner + materiality reason +
next action, deployed 2026-08-09) to instant watchlist alerts. Every
customer-facing delivered alert now carries exactly one named owner and a
non-empty materiality reason before delivery:

- **Named owner**: `digestReviewerLabel` (in `change-intelligence.ts`)
  resolves exactly one accountable reviewer — the workspace owner identity
  when a profile name is known, else the truthful "Workspace owner" role
  fallback. The watchlist/competitor name is never used as the user identity
  (`monitoring.server.ts` now passes `profile?.name ?? null` instead of
  `?? watchlist.name`). Both `deliverWatchlistAlerts` (instant alerts) and
  every digest builder in `digest-email.server.ts` (changed, quiet,
  failed-check, no-record, presence) route through this one resolver.
- **Materiality reason**: `alertMaterialityReason` shares the digest event
  classification (`materialityClausesFromItems`), so an alert and a brief
  never disagree about what a change type means:
  - provisional alerts say the change is unconfirmed;
  - baseline snapshots say they are the starting point;
  - confirmed changes name what moved, derived from the filed events only;
  - a shape with no derivable statement renders an explicit fallback rather
    than an empty reason.
  The P1 follow-up (same PR) fails closed on unevidenced materiality:
  `deliverWatchlistAlerts` resolves every event to its customer evidence
  state via one bounded batched query (`listProofCapturePairsForEventIds`),
  and `buildInstantAlertContent` derives confirmed copy from `verified_change`
  items only — a confirmed status alone, missing/failed proof, an unordered
  capture pair, or an evidence-lookup failure all render the provisional
  block and never block delivery.
- **Every delivery channel**: alert emails render the labeled accountability
  block (Why this matters + Accountable reviewer) via the shared
  digest-email renderer; Slack alerts carry the same two lines
  (`renderInstantSlackText`); digest emails render the same block in every
  state including the explicit no-record failure state. WhatsApp is
  template-bound and not customer-facing in this codebase
  (`isWhatsAppDeliveryCustomerFacing()` is hardcoded `false` in
  `app/lib/ga-customer-surface.ts`), so no customer receives a WhatsApp
  alert without the contract; operator/internal alerts (cron failure,
  watchlist-failure, customer-at-risk, scheduled-work gap) are
  operator-facing infrastructure pages, not customer alert deliveries.

## Regression pins (on this tip)

- `tests/delivery.server.test.ts` — single/batched instant alert emails
  render "Why this matters" + "Accountable reviewer" (named owner identity
  and "Workspace owner" fallback); P1 evidence truth: confirmed alerts stay
  provisional when proof capture is missing, failed, or unordered; confirmed
  materiality renders only for a succeeded ordered capture pair; a mixed
  batch is never marked verified when only one event has evidence; a batch
  with no verified event says the alert is provisional.
- `tests/digest-email.test.ts` — briefs render materiality reason, reviewer,
  and next action (price change, CTA movement, shared triage explanation,
  failed-check periods); truthful "Workspace owner" fallback for blank
  recipient names; explicit failure state for an empty period with no
  heartbeat; alert materiality derived from the shared event vocabulary.
- `tests/change-intelligence.test.ts` does not exist as a standalone file;
  the shared classification is covered through the two suites above.

## Verification on this tip (origin/main `7b618cdb`)

- `tests/delivery.server.test.ts` + `tests/digest-email.test.ts`: 2 files,
  90/90 tests pass (2026-08-11 lane run).
- `tests/instant-alert-delivery-claims.test.ts` +
  `tests/instant-channel-delivery-claims.test.ts` +
  `tests/digest-intelligence.test.ts`: 3 files, 35/35 tests pass.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

---
# BetaList manual listing (2026-08-11 lane 1) — already resolved by PR #577

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane1-betalist-listing-already-resolved`
Base: `origin/main` at `86a154b1`

## Item

- [ ] Prepare a manual BetaList listing for Five to Nine
  [scout 2026-08-09, risk: green] [traction] [unreviewed-by-grok]

## Verdict

No code change was warranted. The item is already landed on `origin/main`:

- PR #577 — `7b618cdb` "docs(launch): prepare manual BetaList listing for Five
  to Nine", merged 2026-08-11 (commit date 2026-08-11 01:10 +0530, before this
  worktree was created at 02:45). The resolving commit is an ancestor of the
  current `main` HEAD (`86a154b1`), and no later commit touches
  `docs/betalist-listing-2026-08-10.md` (single-commit file history).
- The companion SaaSHub listing (PR #607, `86a154b1`, merged 02:30) reuses the
  same canonical copy and explicitly cross-references the BetaList
  preparation, so this package is already the repo's launch-directory
  baseline rather than a throwaway draft.

## Evidence on current main

`docs/betalist-listing-2026-08-10.md` (210 lines) is a paste-ready submission
package: eligibility table against BetaList's submission guidelines,
ready-to-paste form fields (name, URL, tagline with alternates, two
description versions, five topics, freemium pricing value, launch-status
wording), honesty guardrails sourced from the repo's canonical product copy,
asset checklist, submission process notes (verified from the BetaList FAQ),
and an owner-decision list covering the personal fields the form requires
(founder name, location, contact email) plus plan tier and launch wording.

## Re-verification on this tip (2026-08-11, live checks)

Every BetaList claim in the doc was re-verified live on 2026-08-11 by this
lane; the package is still current and accurate:

- `https://betalist.com/criteria` — live; the page's five guideline groups
  (relatively new product, not featured on BetaList before, technology
  startup, distinct decent-looking landing page, visitors able to sign up)
  match the doc's eligibility table row for row, including the
  "Launched weeks ago or longer" less-suitable note the doc's
  launch-status-wording section weighs.
- All five topic URLs resolve (HTTP 200) with the exact names the doc lists:
  `/browse/data-analytics/competitive-intelligence`,
  `/browse/marketing/advertising`, `/browse/data-analytics/tracking`,
  `/browse/data-analytics/marketing-analytic`,
  `/browse/marketing/brand-monitoring`.
- Recommended tagline matches the live homepage SEO title —
  `app/routes/marketing.tsx:40` → "Five to Nine | Know when competitors
  change the offer".
- Signup claim holds: `/auth/signup` route exists (`app/routes.ts:21`,
  `app/routes/auth.signup.tsx`), so the "visitors can sign up" guideline is
  satisfied by a working route, not just a landing page.
- Logo asset `brand/five-to-nine-colored-logo.svg` present in the repo as the
  doc's asset checklist requires.
- `support@0509.io` exists (`app/lib/support.ts:13`) as a candidate for the
  form's contact-email field (owner still confirms the inbox).
- Launch-age analysis is unchanged: live in public early access since
  2026-06-15 (~8 weeks), so the doc's recommendation (option A: submit as
  "recently launched / early access", paid plan, refund if not featured)
  still holds. The one-day gap between the doc (2026-08-10) and this
  re-check does not change any field value.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

---
# Stale open PRs #573/#574/#584 (2026-08-11 lane 1) — already merged / superseded, closed

**Status: resolved; this lane closed the stale PRs and records the evidence.**

Branch: `report/lane1-stale-prs-573-574-584-closed`
Base: `origin/main` at `69cfcbc0`

## Item

- [ ] Close open PRs #573/#574/#584 as superseded — their exact content
  already merged, and rebasing them would just re-apply already-merged
  changes.

## Verdict

All three PRs were already resolved on `origin/main`; no code change was
warranted. #573 and #584 were open and are now closed (with evidence
comments); #574 had already merged before this lane started.

- PR #574 — "docs(marketing): prepare manual SaaSHub listing for Five to
  Nine" — **already MERGED** 2026-08-10T22:41:29Z as `69cfcbc0`, the current
  `main` HEAD. `docs/saashub-listing.md` on the PR branch is byte-identical
  to `origin/main`. Nothing to close.
- PR #573 — "docs(traction): prepare the manual AlternativeTo listing" —
  **superseded by PR #606** (`adceefdd`, merged 2026-08-10T21:30:53Z):
  `docs/alternativeto-listing-2026-08-11.md` (327 lines) is the newer,
  complete listing packet for the same research-desk item (FAQ-verified
  eligibility, ready-to-paste form fields, submission process, honesty
  guardrails). The PR's `docs/growth/*` files are the earlier draft; the
  `docs/growth/` directory no longer exists on main. Closed 2026-08-11.
- PR #584 — "fix(search): make the BL-031 refine-disclosure tests
  typecheck-clean (TS2698)" — **fix already on main**: commit `5021807e`
  (PR #585, merged 2026-08-10) added the `as Record<string, unknown>` casts
  at both spread sites in `tests/search-submission-settle.test.tsx` (lines
  541 and 560 on current main). The only diff between the branch and main
  is formatting (single-line vs multi-line spread); runtime behavior is
  identical. Closed 2026-08-11.

## Evidence on current main

- `git diff origin/main origin/docs/saashub-listing -- docs/saashub-listing.md`
  → empty (PR #574 content identical to main).
- `git show origin/main:tests/search-submission-settle.test.tsx` → lines 541
  and 560 already carry `... (resultsLoaderData.filters as Record<string,
  unknown>), ...`; `git log -S` attributes them to `5021807e` (#585).
- `git log origin/main --oneline -- docs/alternativeto-listing-2026-08-11.md`
  → `adceefdd` (#606), ancestor of current main HEAD.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

---
# Public /search "Landing-page signal" count (2026-08-12 lane 8) — already resolved by PR #553

**Status: already resolved; this lane re-verifies the evidence only.**

Branch: `report/lane8-landing-signal-count-already-resolved`
Base: `origin/main` at `ac393f02`

## Item

- [ ] Stop counting destination URLs as captured "Landing-page signal" on
  public search (scout 2026-08-09, risk: amber).

## Verdict

No code change was warranted. The item landed on `origin/main` as PR #553
(`0940c79b` "fix(search): stop counting destination URLs as captured
landing-page signals", merged 2026-08-09) and remains fully in force on the
current `main` HEAD (`ac393f02`). A previous lane (2026-08-10 lane 2, commit
`7476d4a7`) recorded the same verdict; this lane re-verified it against the
newer tip. No open PR duplicates the item.

## Evidence re-verified on current main (ac393f02)

- **Count source**: `buildSearchAnswer()` in `app/lib/search-answer.ts` is
  the only "Landing-page signal X/Y" count source and its only caller is the
  public /search route (`app/routes/search.tsx`, `buildSearchAnswer({ result:
  visibleResult, ... })`). It counts only captured snapshots:
  `ads.filter((ad) => Boolean(ad.landingPage)).length`. A destination URL
  alone (`ad.landingPageUrl`) never contributes. `git log 0940c79b..HEAD --
  app/lib/search-answer.ts` is empty — no commit since the fix has touched
  the count.
- **`landingPage` is never fabricated from a URL**: `hydrateAdsWithPersistedCreatives`
  (`app/lib/ad-persistence.server.ts`) merges `storedAd.landingPage` only
  from what was actually persisted (a real capture); `search-selection.server.ts`
  uses `Boolean(ad.landingPageUrl) && !ad.landingPage` solely to decide when
  a capture should run, never to count captured signals.
- **Honest missing notes**: URL-only results now report `Landing-page signal
  0/N` with "Not captured yet; use the ad cards as creative signals only" and
  the summary notes ("…signals are missing, so treat the ad creative as the
  current signal." / "…not captured on these matches yet." / "…not captured
  yet."), instead of the pre-fix false `1/1`.
- **Regression pins** (`tests/search-answer.test.ts`): "does not count
  destination URLs alone as captured landing-page signals" pins URL-only ->
  `0/1` + missing note; "counts only captured landing-page snapshots across
  mixed results" pins captured + URL-only -> `1/2`. Both pass on this tip.
- **No other public-search surface overcounts**: `app/lib/search-display.ts`
  renders a captured badge only when `ad.landingPage?.capturedAt` exists.

## Verification on this tip (origin/main `ac393f02`)

- `search-answer.test.ts` + `search-display.test.ts` +
  `landing-page-signals.test.ts` + `search-live-claim.test.tsx`: 4 files,
  74/74 tests pass.
- Full suite: 427 files / 4892 tests passed (69s).

## Files

- `.lane/report.md` — evidence record only; no product code touched.
