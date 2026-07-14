# Customer-readiness remediation

Last updated: 2026-07-14

## Commercial loop under test

- Working buyer: an India-based D2C growth lead tracking 3–10 Meta-heavy competitors.
- Paid loop: landing page → trustworthy live proof → saved watchlist → useful recurring brief → Starter checkout.
- This is a working hypothesis, not validated product-market fit. Customer interviews, pilot use, willingness to pay, and a real payment remain external proof gates.

## Rules for this backlog

- Work as complete vertical customer journeys. A journey is not done when only its screen or only its backend is fixed.
- Never present demo, broader, stale, or unverified data as live verified proof.
- Closure states are `fixed`, `verified`, `blocked`, or `external proof required`.
- A blocked slice stays unintegrated and undeployed; record its exact branch, fingerprint, and missing gate, then continue with the next independent journey.
- Provider mutations, production deployment, real checkout, customer outreach, and privacy-affecting analytics require separate authorization.

## Parked reliability candidate

- Status: `blocked`.
- Branch/worktree: `codex/fable-recovery-p0-p2` at `/Users/nish/.config/superpowers/worktrees/0509/fable-recovery`.
- Frozen HEAD: `fc4a1fc1cfbd355a311d710a940995fbf0aa1279`.
- Frozen review fingerprint: `e6d4253ae516b673f0c5f9ef7f7d61c2fd8de6f3498ff27fd08e8fefbc3928e2`.
- Local proof: 204 test files / 2,268 tests, focused 222 tests, generated types, TypeScript, production build, LSP, and compaction-equivalence checks passed.
- Missing gate: review cycle `a98f5f83-5bab-4c23-985b-4273294f4dd5` still reports `final autoreview is not clean`; the candidate has not passed release verification or cycle close.
- Integration/deployment: none. Do not resume this branch until every other independent P0/P1 journey has been attempted.

## Frozen Journey 3 candidate

- Status: `blocked` and unintegrated.
- Branch: `codex/journey3-blocked`.
- Frozen HEAD: `4f8be88ceb40fab020ddff692346dc4cee3e5a74`.
- Local proof before freeze: 212 Vitest files / 2,279 tests, generated Cloudflare and route types, TypeScript, production build, and all 13 authenticated browser journeys passed.
- Missing gate: final xhigh review thread `019f624e-9314-77c2-967f-0898bb960f72` reports four unresolved release findings: request-lifetime first-scan dispatch instead of a durable consumer; post-claim setup failures can strand the queue; legacy recipient rows are not bound to the currently verified account email; and test-email dispatch can race unsubscribe.
- Integration/deployment: none. Do not resume until every other independent P0/P1 journey has been attempted.

## Journey execution order

| Journey | Current state | Required completion proof |
| --- | --- | --- |
| First visit → value → signup | verified | Local rendered journey at 375/768/1440 px; intent-preserving signup aliases and server validation pass. Real email delivery remains an external provider gate. |
| Onboarding → first useful search → credible proof | verified | Local V2 proof candidate, canonical-save integrity, honest source/freshness, keyboard activation, browser and contract tests pass. Committed rollout remains shadow until an authorized live canary promotes it. |
| Save competitor → monitoring → alerts/digests | blocked | Candidate frozen at `4f8be88`; exact candidate must remediate all four final-review findings and pass a clean release review. |
| Evidence → reports → share/export → client delivery | open | Entitlement-aware actions, evidence freshness, share/export/client-room browser and contract proof |
| Plan → checkout → entitlements → billing lifecycle | open | Pricing/error states, exact entitlements, safe billing state machine, external money/provider gates recorded |
| Return value → account/team/support/recovery | open | Account/team/support UX, operational recovery, observability, accessibility, and retained-value proof |

## Canonical findings matrix

| ID | Severity | Observed evidence | Customer / commercial effect | Dependency and acceptance proof | Owner | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| CR-001 | P0 | The homepage CTA opens an exact `nykaa.com` search. Live exact and website+broader routes returned zero, while `?query=nykaa` returned 10 raw ads. Search V2 defaults to legacy and its domain provider query does not match Meta's discovery behavior. | The featured first-value promise fails before signup. | Exact search must query broadly enough to discover candidates, show only independently verified domain/entity matches, label broader candidates honestly, expose source/freshness, and place the selected proof above the fold. Verify with fixtures, local browser states, and an authorized live canary. | Search + acquisition | fixed; local V2 verified; external live canary required |
| CR-002 | P1 | Instant email, WhatsApp, and Slack paths read dedupe state, call the provider, then persist/finalize; concurrent scans or retries can both send. | Duplicate alerts destroy trust in the core monitoring promise. | Atomically claim a pending attempt before provider I/O; CAS re-arm failed/stale attempts and CAS finalization. Concurrent tests must produce one provider call and one durable attempt. | Delivery reliability | accepted |
| CR-003 | P1 | Public copy alternates among growth, sales, and revenue teams. The hero is explicitly a synthetic sample; no customer quote, pilot, retained usage, or paid proof exists. | Buyers cannot tell whom the product is for or trust that it works in a real team. | Align in-repo copy to the working buyer. Real proof, interviews, and payment remain external gates. | Product + founder | fixed in repo; external customer proof required |
| CR-004 | P1 | Commercial discovery can fall back to demo mode when browser/API providers are absent; the landing promise says live search. | A prospect can mistake sample data for current market evidence. | Show provider/source, verification scope, freshness, and degraded/unavailable state before results. Demo must be unmistakably labeled. Provider health remains an external runtime gate. | Search + reliability | fixed in repo; external provider proof required |
| CR-005 | P1 | There is no acquisition denominator, UTM/referrer capture, activation entity, cohort, or paid conversion attribution. Existing rate-limit hashes cannot answer funnel questions. | Sales failure cannot be localized to traffic, first value, activation, retention, or checkout. | Prepare a privacy-reviewed event/data specification after the journey stabilizes. Do not collect new user data without approval. | Product analytics | external privacy gate |
| CR-006 | P1 | Internal harnesses and synthetic fixtures exist, but no documented design partner, prospect observation, pilot retention, willingness-to-pay result, or real payment exists. | Engineering readiness is being mistaken for market validation. | Observe at least five target buyers, run a paid pilot, and record activation/retention/payment evidence. | Founder / sales | external customer and money gate |
| CR-007 | P2 | Signup requires “Company or agency,” but the action does not persist it as an organization/workspace attribute. | The form asks for information and then loses it, undermining onboarding continuity. | Persist it with official Better Auth/schema behavior or remove the field. Test verification and workspace creation paths. | Activation + auth | fixed and verified |
| CR-008 | P2 | Free/API users can save email/digest settings that entitlement/runtime code later suppresses; responses can claim they are enabled. | Settings lie and recurring value silently fails. | Return and render effective entitled settings; reject or lock unavailable controls before secret/config entry. Test UI and agent actions by plan. | Entitlements + delivery | accepted |
| CR-009 | P2 | Watchlists, collections, digests, and client rooms render enabled report/share/CSV/JSON actions that later return plan gates; client rooms create report references before the Agency gate. | Users invest work and hit surprise 403/upgrade dead ends. | Load entitlement context and render a clear locked/upgrade state before action. Preserve full Agency flow. Test Scout, Starter, and Agency. | Entitlements + UX | accepted |
| CR-010 | P2 | Slack configuration can be entered before the plan rejection is shown. | Users disclose/setup a secret only to learn the feature is unavailable. | Show the plan-aware lock before secret input and preserve server enforcement. | Notifications + security UX | accepted |
| CR-011 | P2 | Reports use a bounded recent event window/stored digest and can render without a client-ready evidence state or clear freshness/next-scan signal. | The recurring artifact can be empty, stale, or ambiguous. | Show evidence freshness and next scan; disable client-ready claims/actions until sufficient evidence exists. Test empty, stale, current, and failed-scan states. | Reports + retention | accepted |
| CR-012 | P2 | Pricing preview errors are swallowed; cancellation is email/support-only; live Starter plan-change/cancel proof is unverified. | Prospects can see missing pricing or fear lock-in; billing trust is incomplete. | Render explicit pricing-unavailable recovery. Add self-serve cancellation only if official Dodo capability is proven; otherwise create a traceable support status. Live checkout/change/cancel is an external money/provider gate. | Billing + support | accepted / external runtime |
| CR-013 | P2 | Same-key concurrent included-quota reservations can increment usage twice while one reservation insert wins. | Customers can lose included evidence checks without receiving value. | Claim the logical operation atomically before increment; concurrent tests must consume once and return one durable reservation. | Data integrity | accepted |
| CR-014 | P2 | Search shadow mode is never executed by the public route; cache probing also ignores shadow. | Relevance promotion can occur without comparison data, and selected results can be rate-limited incorrectly. | Execute an independent V2 comparison while returning the untouched legacy response; require both caches before treating a selection as warm. Verify emitted comparison and unchanged response. | Search reliability | fixed and verified |
| CR-015 | P2 | The free-offer copy and entitlements differ: one activation watchlist exists, but there are no scheduled checks/digests. | “Free monitoring” can imply recurring value that the plan does not provide. | Use one canonical statement: one free activation watchlist; retained scheduled monitoring requires a paid plan. Test marketing, onboarding, billing, and settings copy. | Packaging + copy | accepted |
| CR-016 | P2 | First-view proof is synthetic; broad results are below the fold, selected detail appears after the list, and assets often render as placeholders with dense raw ad text. | Even when data exists, the prospect does not receive a concise decision artifact. | Make the verified selected proof the primary above-fold result, keep source/reason visible, and summarize without inventing claims. Validate at 375, 768, and 1440 px. | Search UX | fixed and locally verified |
| CR-017 | P2 | Anonymous sales/support/migration expectations are not explicit; customer outreach and lead handling have no approved process. | Interested prospects have no clear human fallback and privacy handling is undefined. | Define a privacy/legal-approved lead and support process before collecting contact data or outreach. | Founder + privacy | external gate |
| CR-018 | P2 | Recurring scan, digest delivery, and report usefulness have internal tests but no current authorized end-to-end customer/runtime proof. | The retention loop may work in code but not in the customer's inbox/workday. | Run authorized canaries for scan → evidence → digest → report after code fixes; never claim runtime proof from fixtures. | Operations + delivery | external provider gate |
| CR-019 | P3 | CSP permits inline script/style. No exploit or unsafe sink was demonstrated. | Defense in depth is weaker than a nonce/strict policy. | Migrate only with a staged CSP report/compatibility plan and official framework/Cloudflare guidance. | Security | deferred, no demonstrated blocker |
| CR-020 | P3 | Labels/ARIA are broadly present and responsive hero checks passed, but no complete keyboard/focus/screen-reader E2E exists. | Hidden accessibility failures may still block some buyers. | Add automated keyboard/focus checks for the canonical public journey and manually verify screen reader semantics. | Accessibility | keyboard/focus fixed and verified; manual screen-reader proof required |
| CR-021 | P3 | Launch documents still cite July 2 and older migration ceilings (0060/0062) while the repo includes 0063–0066. | Operators can make release decisions from stale evidence. | Refresh only from rerun validators and current proof; do not rewrite old claims as current without verification. | Operations docs | accepted |
| CR-022 | P3 | Bounded N+1 access checks remain in scheduled fanout paths (current caps 40/100). | Cost/latency can grow with scale, but it is not a current release blocker. | Add query/cost measurement before optimizing; revisit when limits or real workload justify it. | Performance | deferred with bound |
| CR-023 | P3 | No retention cohorts or report/digest usefulness metric exists. | Recurring value cannot be distinguished from account creation. | Include retention/usefulness in the privacy-reviewed measurement specification; implement only after approval. | Product analytics | external privacy gate |
| CR-024 | P1 | Search collection saves previously accepted client-supplied ad JSON; the first canonical-ID replacement could expose global external evidence and regress richer shared ad captures. | A forged or stale save could corrupt proof or disclose another workspace's manually supplied evidence. | Accept only server-canonical public Meta evidence, reject external/demo rows, strip query-scoped matching metadata, and preserve non-null/newer capture evidence. | Search + data integrity | fixed and verified |

## Current visual evidence

Accepted screenshots from the 2026-07-14 live audit are stored outside the repository at:

`/Users/nish/.codex/visualizations/2026/07/14/019f5ebd-c5b2-77c2-9358-256d5a40e97a/0509-goal-audit`

They cover the homepage at 375/768/1440 px, exact-search empty state, broad results, selected proof, signup, the final 375 px V2 proof state, and the final 375 px onboarding form.

## Closure log

### Journeys 1–2 candidate — 2026-07-14

- State: `verified` locally on `codex/customer-ready-journey`; no integration, push, deployment, provider mutation, or money movement.
- First visit: live-search form moved into the first viewport; the value story and sample/live distinction are explicit; `/login` and `/signup` aliases preserve safe intent; the unused company field is removed.
- First value: domain discovery uses a brand-sized provider query but exact results remain independently verified; mixed broader results separate verified and related counts; source, cache freshness, capture status, and degraded/sample states are explicit.
- Activation: signup failures retain safe form values without putting names in URLs; onboarding starts with one competitor, completes via keyboard at 375 px, creates the watchlist, marks onboarding complete, and queues the first scan.
- Integrity: collection saves accept only a canonical public Meta ad ID; private external proof is rejected; persisted landing/creative evidence is non-regressive; query-scoped domain matching is not persisted globally; logs contain only a domain hash.
- Rollout: committed configuration is `shadow`. Shadow schedules a separate V2 comparison outside the customer response path and returns the untouched legacy result; customer rate-limit decisions use the returned legacy cache. Promotion to V2 requires an authorized live canary and explicit configuration change.
- Data integrity: V2 hydrates retained canonical evidence before exact classification; broader selection/pagination preserves broader scope; out-of-order landing/creative captures and same-key evidence analysis cannot overwrite newer canonical proof.
- Local proof: generated route types, TypeScript, and the production build passed; 209 Vitest files / 2,207 tests passed. The authenticated browser suite passed all 11 journeys; the shadow-mode public suite passed 5 with the V2-only proof check intentionally skipped; the separately enabled V2 rendered proof check passed. Responsive layout, proof focus order, intent-preserving signup, onboarding, and honest gated states are covered.
- External gates: real Better Auth email/magic-link completion; production Meta/browser canary; production configuration promotion; customer observation, retention, and payment proof; privacy approval for funnel measurement.
