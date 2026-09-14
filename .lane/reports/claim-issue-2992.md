# claim/issue-2992 — umbrella: the cross-source honesty layer + the joint non-Meta /status metric

## What this lane shipped (and why the splits do not own it)

#2992 was split 2026-09-12 into three per-source agent-ready lanes (#3195 TikTok /
#3196 LinkedIn / #3197 Google); this umbrella lane ships the layer none of them
owns, exactly as the split comment records:

- `app/lib/ad-source-coverage.ts` (NEW, 90 lines) — ONE pure, client-safe constant
  (`AD_SOURCE_COVERAGE` + honesty line + free/paid derivations), one entry per tracked
  ad source, each stating what it covers and what it does not, sourced from the
  research/legal memo pinned on the issue (00 Inbox/agent-drop/pi/vps/
  2026-09-12-meta-single-source-research.md — the issue designates that memo as the
  source of these statements). Same house pattern as the capture-validity public rules:
  pure data, zero imports, so the rendered pages and the AI-engine markdown cannot drift.
- `/pricing` — "Ad sources" section between the plan grid and "Price of knowing", plus
  the /pricing AI-markdown body assembling the SAME facts from the SAME constant (#2299
  no-drift rule).
- `/docs` — the "Where the ads come from" block, from the same constant.
- `/status` — the joint metric: share of tracked brands with >=1 non-Meta ad captured.
  Denominator = the exact `is_active = 1` predicate the existing Scheduled-monitoring
  counter uses (app/lib/public-status-counters.server.ts:770, pre-existing); numerator
  = watchlists whose captured `source_snapshot` shows >=1 google_ads/linkedin/tiktok
  ad, `json_valid`-guarded, judged on the payload each adapter itself stores.

No adapter, flag, entitlement, migration or gate path changed: the umbrella adds zero
new machinery. `tests/lane-evidence-collision.test.ts` shape: flat, `.md`, branch-derived.

## Copy-vs-adapter parity (verified 2026-09-14, not vibes)

- LinkedIn: `buildSearchUrl` sets `geo: "United States"` → copy says "United States
  listings" (linkedin-ads/linkedin-ad-library.server.ts).
- Google: `fetchCreativesByDomain(domain, { maxCreatives: 200 })` → copy says "newest
  200 kept" (google-ads.server.ts; GoogleAdsSnapshotPayload.creatives = `$.creatives`).
- TikTok: TiktokAd carries `firstShown`/`lastShown`/`uniqueUsers`, cards sorted
  `last_shown_date,desc`, 12 per capture → copy: "first- and last-shown dates, and
  unique-user counts, newest dozen" (tiktok-ads/tiktok-ad-library.server.ts; payload
  `$.ads` per TiktokPayload guard).
- LinkedIn payload `$.ads` per LinkedInAdsSnapshotPayload (linkedin-ads.server.ts:57-61).
- Meta: "country by country" matches the country filter in the public-library path
  (ad-source.server.ts; primary path is the public-library browser scrape,
  meta-library-browser.server.ts); the official API's EU/UK commercial-ads limit is the
  research memo's premise, which the issue pins as the statements' source.

## Run evidence

- `npx vitest run --configLoader runner --project node --changed origin/main` (branch
  rebased onto current origin/main 522c79d4c first) → 49 files, 572/572 passed, exit 0,
  FIRST RUN clean (inner loop 1/5 rounds, nothing to adjudicate).
- `sgscan` (base = origin/main 522c79d4) → "No new security findings.", exit 0.
- `fleet-no-agent-names-check --pr-body ... --commit-range origin/main..HEAD` → exit 0.
- `prove-one-run-check` (name-status + numstat) → "OK: net-positive diff (+382 lines)
  carries net-positive-because:", exit 0.
- `fleet-exec-review-canary --body` → "OK: Verification/run-proof receipt present", exit 0.
- `fleet-token-efficiency-check --name-status` → exit 0.
- `crgate` → "CodeRabbit is not signed in on this machine": the local CodeRabbit gate is
  unavailable on this host (auth not stored here); noted, not silently skipped — the
  PR-level review gates still cover the PR.
- Organ check: no `config/fleet-organs.json` in 0509 and no organ paths in the diff —
  the organ-heartbeat: not-an-organ declaration stands in the PR body.

## Scope note (stays out of this PR, by the issue's own split)

The per-source activations — adapters on, flags on in production, /ads/:domain copy,
e2e fixtures, capture-validity proofs, per-source /status metrics and rate budgets —
belong to #3195 / #3196 / #3197 (open lanes). The /status joint metric reads whatever
those sources have captured, so it honestly reports 0% until they land. The coverage
notes' plan gating is pinned by tests/ad-source-coverage.test.ts against the
authoritative plan-entitlements catalog, so the copy cannot drift when those lanes
ship.

## Continuation — 2026-09-13, finish session (pi-issue-0509-2992, second run)

The unit's first run armed PR #3401 at 19:19:52Z before finishing; required
Gitleaks failed, so the arm went BLOCKED and stayed there. This session
finished the unit:

- **Gitleaks incident (live, not vibes):** required check `Gitleaks` = FAIL,
  exit 2, one finding — rule `linkedin-client-id` at
  `.lane/reports/claim-issue-2992.md:31`, fingerprint
  `b06fbcaabd29a2efb924020b95854b3d8421ecb4:.lane/reports/claim-issue-2992.md:linkedin-client-id:31`
  (CI run 34777353800, job 103777791782; reproduced locally with gitleaks
  8.30.1 over the PR range 522c79d4..HEAD, exit 2, same single finding).
  Root cause: the 14-char function name `buildSearchUrl`, backticked in this
  report's parity section, matches gitleaks' 14-alphanumeric
  linkedin-client-id heuristic — entropy 3.52, a prose backtick, not a
  credential. Same false-positive class as the two precedents already in
  `.gitleaksignore`.
- **Fix:** the documented house convention — fingerprint + why-comment
  appended to `.gitleaksignore`, pinning the finding commit exactly. No
  product code, no workflow, no mechanism touched.
- **Proof:** re-run of the identical CI invocation over the extended range
  → `no leaks found`, exit 0.
- **Arm discipline:** PR #3401 disarmed (`gh pr merge --disable-auto`) the
  same turn the incident was found, so the required reviewer round lands
  BEFORE the arm re-fires the moment checks go green (fleet-ops#4557: a
  merge 90s after its block comment has no teeth). Auto-merge re-armed only
  after the round, its adjudication, and any Act-on fixes are in.
