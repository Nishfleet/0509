# Lane evidence — claim/issue-3204 (Nishfleet/0509#3204)

LinkedIn posts → the mention table: closes this issue's acceptance on the
#3178 substrate. The lawful, $0, public surface is the tracked organization's
OWN published posts via the official versioned Posts API
(`GET /rest/posts?author=urn:li:organization:{id}`, `sortBy=CREATED`,
`count=25` of the documented max 100) authenticated by the stored 3-legged
grant (`r_organization_social`) the `linkedin` connector already holds.
Unofficial scrapers were researched and rejected (see
docs/mentions/PLAN.md §2 LinkedIn row + §8). Competitor coverage stays
`LIMITED_COVERAGE` — there is no public keyword search of others' posts; that
is the issue's one allowed exclusion, documented in the /status note.

Provenance: this unit's first run banked
`wip/pi-issue-0509-3204-20260913T172058Z` @ b6a0c7154 (salvage, issue
comment); the 17:53:35Z unit finished the implementation as one commit
(92d42bfe8, 18:24:02Z) and died at 18:34:16Z (StartLimitBurst) before
pushing; this session re-claimed at 18:54:14Z, inherited that commit, and
rebased onto origin/main (522c79d4c — #3199's #3398 landed six minutes after
the prior unit's last activity).

Rebase resolution (the one textual conflict, `tests/status.route.test.ts`):
both #3199's Substack-row pin and #3204's flip-assertions kept verbatim;
the superseded line is #3199-era's `expect(markup).toContain("unavailable")`
— true only while the LinkedIn row still said "unavailable". After the #3204
flip every `presenceSourceCoverageForDocs()` entry is `productionStatus:
"gated"`, so the stronger `expect(markup).not.toContain("unavailable")`
holds; #3199's Substack + "no free global keyword search" assertions stay.

Delta (the disjoint-slice rule — this issue's adapter, flag, tests and
coverage note only; zero edits to the #3178 shared interface: the access-gate
change adds one `||`-chain entry, the registry change passes `target` to the
connector's own `poll`, both additive):

- MOD `app/lib/presence-connectors/linkedin.server.ts` — the #3204 poll:
  exactly ONE serialized versioned Posts-API GET per poll
  (`X-Restli-Protocol-Version: 2.0.0` + `LinkedIn-Version: 202508`, the
  fetched page's own versioned string), stored-grant auth, only
  `lifecycleState: "PUBLISHED"` items, canonical `www.linkedin.com
  /feed/update/...` URLs, `presenceContentHash` dedup, honest degraded
  results (429 → rate_limited, 401 → reconnect-required, parse → error;
  never fabricated items), fail-closed when no connection / no organization /
  flag off / credential unrestorable (zero requests).
- MOD `app/lib/presence-access-gates.server.ts` — `linkedin` joins
  `connectorHasCustomerPollPath` (self-only; competitor side stays
  competitor_limited) + `PRESENCE_LINKEDIN_ROLLOUT` rollout read
  (off by default — activation is a separate rollout decision, exactly the
  #3199/rss precedent).
- MOD `app/lib/presence-connector-registry.server.ts` — the dispatch hands
  the connector its target (`poll(ctx, target)`).
- MOD `app/lib/presence-source-coverage.server.ts` — the /status LinkedIn row
  flips unavailable → gated with the verbatim note (own-organization posts of
  a CONNECTED account, $0, stored OAuth grant, Competitor coverage stays
  LIMITED_COVERAGE — the only allowed exclusion).
- MOD `docs/mentions/PLAN.md` — §2 LinkedIn row: shipped-#3204 wording, the
  searched + rejected collectors (GitHub star-sorted, 2026-09-13:
  joeyism/linkedin_scraper 4.5k★, stickerdaniel/linkedin-mcp-server 3.5k★ —
  unofficial, undocumented, no ToS posture; Ebazhanov/skill-assessments 28.8k★
  + Liger-Kernel 6.6k★ matched the search but are not collectors) and §8 the
  live-fetched Posts-API details (endpoint, headers, count bounds, element
  shape).
- NEW `tests/integration/linkedin-mention-connector.integration.test.ts` —
  real workerd + real D1 (real migrations; migration 0055's connector_id
  CHECK already allows 'linkedin', so no schema change, per the REUSE rule).
  Hermetic network: a mock `fetchImpl` serves the documented Posts-API
  fixture at the `presenceSafeFetch` seam while every request is still proven
  to carry the stored credential + versioned headers. 7 tests.
- MOD `tests/presence-tracking.test.ts`, `tests/presence-source-coverage.test.ts`,
  `tests/status.route.test.ts` — the flag, the coverage note, and the public
  /status markup (see the rebase resolution above).

## Acceptance → proof

| Issue acceptance | Proof |
| --- | --- |
| e2e fixture returns >=1 mention | integration `e2e fixture: the PRESENCE_LINKEDIN_MOCK seam returns >=1 mention into the mention table, deduped on re-poll` — real D1 `presence_item` rows, canonical /feed/update/ URLs, content-hash dedup on re-poll |
| rate budget tested | integration `issues exactly one Posts-API call with the stored grant and the versioned headers, lands only PUBLISHED posts` |
| /status per-source row | integration `surfaces in the coverage table as gated — the /status per-source row` + node `tests/status.route.test.ts` (public markup: gated, verbatim note, no "unavailable" left) |
| kill flag / capture-validity gate | integration `fails closed with zero requests when no connection, no organization, the kill flag is off, or the stored credential is unrestorable` — the shared access gate decides BEFORE any network hop |
| honest degraded results | integration: 429 → rate_limited, 401 → reconnect-required, empty-org → ok:true + zero items, never fabricated |
| required: collectors researched first | PLAN.md §2 + §8: searched + rejected cited, dated 2026-09-13 |
| public surfaces only, no paid vendor | $0 — the stored 3-legged grant already authenticates; no new vendor, no paid surface |
| no edits to the shared interface | additive only (see Delta) |
| if no lawful public surface exists → document | not needed — the lawful surface exists (documented anyway: ToS prohibit scraping, unofficial collectors rejected, Competitor = LIMITED_COVERAGE = the only allowed exclusion) |

## Run results (this unit, on 049a20c4c = origin/main + this fix)

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → **98 files / 1145 tests, all passed** (48.84s) — affected-tests mode pulls
  every presence-* dependent of the touched modules.
- `npx vitest run --configLoader runner --project workers
  tests/integration/linkedin-mention-connector.integration.test.ts`
  → **1 file / 7 tests, all passed** (7.53s) on real workerd + D1.
- `sgscan --base origin/main` → exit 0, no new security findings.
- `crgate --base origin/main` → exit 0 with "CodeRabbit is not signed in on
  this machine" (informational notice, not a failed command): the local
  reviewer seat for this PR is the #3121 senior-seat pick, and CI's
  CodeRabbit still reviews the PR itself.
- CI owns coverage + typecheck (fleet-ops#4891): neither run locally;
  `VITEST_MAX_WORKERS=2` respected, suites strictly sequential.

## Adjudication (review-adjudication — every finding, exactly one bucket)

Pre-registered (this unit's own findings, before the reviewer round):

- **Consider** — none. The rebase conflict was resolved above (documented, not
  adjudicated-away).
- **Noted** — #3199-era's `expect(markup).toContain("unavailable")` in
  `tests/status.route.test.ts` superseded by this issue's stronger
  `expect(markup).not.toContain("unavailable")`: the #3204 flip makes both
  simultaneously unsatisfiable, the module proves which side is true, and
  #3199's Substack + limit assertions survive verbatim. Reviewer-visible by
  design (the in-test comment + this record).
- **Noted** — `PRESENCE_LINKEDIN_ROLLOUT` ships off by default; activation is
  a separate rollout decision (identical to the rss/#3199, bluesky and
  threads precedents). Recorded as this PR's loose end, not an acceptance gap:
  the termination's "captured" is proven by the real-D1 e2e-fixture run, the
  same bar #3199 met.
- **Dismissed-with-reason** — the issue-trail's
  "possible duplicate of #3198 (score 1.00, cluster-size)" — #3204 is the
  LinkedIn slice of the #3171 split family (#3198 is a different source in
  the same cluster); the intake's not-auto-closed note already settled it.

Reviewer-round findings (if any) land here in a follow-up commit, exactly as
the #3199 precedent did (251757439).
