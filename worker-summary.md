# Worker summary — sample brief truthfulness (lane9)

Date: 2026-08-06 · Packet: "Make the anonymous homepage sample brief truthful and decision-ready"

## Goal

Every sample-proof field on the anonymous homepage brief must render a truthful non-empty value
or an explicit unavailable state, and the source trail must be real linked evidence or explicitly
labeled illustrative. No invented live evidence. Authenticated/live monitoring untouched.

## What was observed / investigated

- Live SSR of `https://0509.io/` at HEAD (1f865fa) renders all seven proof fields with the
  fixture values from `app/lib/demo-proof.ts` — the observed "blank definitions / empty trail"
  could not be reproduced against the current SSR bundle (possible stale/cached deployment or
  tooling artifact at inspection time). Regardless of the reproduction, the packet's acceptance
  criteria applied to the fixture as checked in:
  - `Proof status: "Verified evidence"` and `confidence: "Verified evidence with source and
    freshness attached."` were **untruthful over-claims** on a `status: "sample_only"` fixture —
    exactly the "plausible-looking value" class the packet forbids.
  - The source trail rendered source *types* with no links and no explicit illustrative label.
- No auth, billing, D1, migrations, deploy scripts, pricing/legal copy, or monitoring code was
  touched. No provider calls or persistence added.

## Changes (all in owned scope)

| File | Change |
|---|---|
| `app/lib/demo-proof.ts` | `proofStatus` → `"Sample-only evidence"`; `confidence` → `"Sample-only brief: the evidence above is illustrative and was not captured from a live watch."`; added fixture-backed `sampleOnlyNote` (decision summary) and `trailNote` (source trail) fields. No URLs invented. |
| `app/routes/marketing.tsx` | Renders `demoProof.sampleOnlyNote` in the Decision summary card and `demoProof.trailNote` in the Source trail card, both as `<p className="ld-case-note">`. All seven `<dt>/<dd>` fields unchanged and non-empty. |
| `app/app.css` | One rule: `.ld-case-card .ld-case-note` (0.8rem, `--ld-ink-soft`, margin-top 12px). Wraps on mobile; `dl` grid/flex behavior untouched. |
| `tests/marketing-sample-brief.test.tsx` | NEW render test: all 7 fields render non-empty; Proof status = "Sample-only evidence"; no "Verified evidence" anywhere; source trail = 3 non-empty items with explicit illustrative label, no `href=`/`<a`/`http(s)` in the trail; `.ld-case-note` CSS contract exists. |
| `tests/demo-proof.route.test.ts` | Updated confidence/proofStatus assertions to the truthful values; added per-item non-empty proof-trail checks and note presence checks. |

## Acceptance criteria status

1. Every sample-proof field renders a truthful non-empty value — YES (7/7 asserted; Proof status
   and confidence now truthful; Freshness already labeled "Sample captured at 05:09").
2. Source trail: real linked evidence **or** explicitly labeled illustrative — YES: explicitly
   labeled "Illustrative sample — a real brief links each change… without live links." No empty
   items, no fake URLs (asserted).
3. Authenticated/live monitoring unchanged — YES: only `demo-proof.ts`, `marketing.tsx`,
   `app.css`, and sample-API tests changed; `proof-classification.ts` "Verified evidence" label
   for live captures untouched.
4. Desktop/mobile readable, no new errors — note text inherits card wrap (`overflow-wrap:
   anywhere`), `dl` grid at narrow widths already handled; build passes; no runtime code paths
   added.
5. Focused regression tests — added (`tests/marketing-sample-brief.test.tsx` + route test
   updates).
6. Verification commands — see exit codes below.

## Verification (exact exit codes)

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | **0** | clean |
| `npm test` (full suite, with changes) | **1** | 8 failed / 4643 passed (4635 passed + 8 failed; 5 files). All 8 are pre-existing timing/flaky families: `ad-source.test.ts`, `deploy-window-lock.test.ts`, `search-submission-settle.test.tsx`, `share-pdf-rail-visibility.test.tsx`, `watchlists.route.test.ts` (10s timeouts, lane races, 90s settle window). Verified pre-existing by stashing this change and re-running the same 5 files on the clean tree: same files fail (5–7 failures across two clean runs — flaky). **None of the failing files touch this packet's scope.** |
| `npm run build` | **0** | built in 27.4s; bundle contains the new truthful fixture strings, zero "Verified evidence" in the marketing bundle |
| `git diff --check` | **0** | clean |
| `/home/nish/.local/bin/sgscan` | **1** | whole-tree fallback ("No diff against origin/HEAD — scanning the working tree…"): 17 WARNING + 27 INFO, **0 ERROR**, **no findings in any changed file** (scoped `semgrep` over the 5 changed files: 0 findings, exit 0). Exit 1 = WARNING bucket, all pre-existing. |
| Focused tests: `marketing-sample-brief.test.tsx` + `demo-proof.route.test.ts` + `marketing-rebuild.test.ts` | **0** | 30/30 pass |

Pre-existing scan findings (whole-tree, separate from this change): 17 WARNINGs —
`detect-non-literal-regexp` (14: `app/lib/angle-classifier.ts:211`,
`app/lib/data/operator-delivery-reconciliation.server.ts:687`, `app/lib/language-classifier.ts:327,382,388`,
`app/lib/meta-library-rendered-card-parser.server.ts:896`, `app/lib/presence-connectors/website.server.ts:408`,
`app/lib/presence-robots.server.ts:218`, `app/lib/website-identity.server.ts:137,144,145`,
`e2e/journey-1-release.spec.ts:159`, `scripts/monitoring-fanout-canary.mjs:22`,
`scripts/validate-market-signal-report.mjs:42`), `insecure-object-assign` (2:
`scripts/monitoring-fanout-canary.mjs:146,182`), `react-dangerouslysetinnerhtml` (1:
`app/lib/seo.ts:139`), plus 27 INFOs. An earlier sgscan run today (12:48, `/tmp/sgscan.out`)
reported the same no-diff fallback with 4 WARNINGs (ci.yml ×2, index.html:13 missing-integrity,
worker/index.js:1110 detect-non-literal-regexp), also exit 1. All pre-existing; none introduced
by this packet.

## Blockers

None. No pricing/legal promise, migration, auth, payment, or deploy path needed changing; the
sample brief is purely local static presentation data as assumed.

## Not done (by instruction)

No commit, no deploy, no PR, no descendants. Diff is uncommitted in this worktree.
