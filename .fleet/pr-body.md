## What

net-positive-because: the diff is the shipped capture-validity gate (helpers, wiring, render/MCP surfacing) plus its regression test — net-positive test+feature lines that are the smallest durable fix and its prevention mechanism, not speculative scaffolding.

Closes #1996. `/timeline/:domain` was publishing geo-variance + cookie-banner capture artifacts as real offer transitions — e.g. the live Nike SG (`/sg/`, 7 Sept: "Shop Now", "$149") vs Nike FR (`/fr/`, 8 Sept: French consent CTA, price "—") pair rendered as a false "Nike changed their CTA and dropped their price" transition on the public indexed flagship surface. This PR lands a capture-validity gate so such pairs become an explicit suppressed state with a reason, never an offer transition, plus a regression gate that fails on the old code.

**Logic — `app/lib/offer-timeline.ts`**

- `geoLocaleSegment(url)` — returns the first path segment when it is a `SUPPORTED_COUNTRIES` ISO code (`/sg/` -> `"sg"`, `/fr/` -> `"fr"`), else null.
- `isCookieBannerOrConsent(text)` — true when the text matches a curated consent/ads-personalization string list (French `"publicités personnalisées"`, `"gérer mes cookies"`, `"manage cookies"`, `"accept all cookies"`, `"privacy settings"`, etc.), case-insensitive substring. Tailored to consent phrases so a "Personalised winter sale" headline or a "Shop Now" CTA still diffs normally.
- `captureValidityReason(previous, current)` — returns `"geo locale change"` when both canonical URLs carry a known locale segment and they differ; `"cookie banner / consent string"` when the current CTA/headline is a consent string; else null (genuine change diffs normally).
- `buildOfferLedger` — between run-collapse and diff, computes the validity reason; when non-null, the entry is emitted with `transition: null` and `suppressedReason` set (no phantom change, no fake price `$149 -> —` disappearance). `OfferLedgerEntry` gains optional `suppressedReason`.

**Phase 6 (follow-on): skip-suppressed diff baseline** — the diff/gate baseline is the last NON-suppressed emitted entry (`lastNonSuppressedEntry`), never the raw last one, so a later same-region capture can never diff against a suppressed placeholder (e.g. a "—" price or consent CTA) and fabricate a "price restored from —" transition. Suppressed states remain emitted as their own labeled dated states; only the baseline skips them.

**Render + MCP — `app/components/offer-timeline-ledger.tsx`, `app/lib/offer-timeline-agent-tools.ts`**

- Ledger renders `Capture suppressed: <reason>` when `transition` is null and `suppressedReason` is non-null (instead of the misleading "First offer on record.").
- `OfferHistoryEntryPayload` gains `suppressedReason` and sets `changes: null` for suppressed states, so MCP consumers report the reason instead of fabricated field changes.

**Tests**

- `tests/offer-timeline-geo-variance-phantom.test.ts` — NEW regression gate (fleet-ops#366): (a) real sg+fr Nike pair emits NO offer transition (suppressed with `geo locale change`); (b) genuine same-geo `$149 -> $129` price edit still emits exactly one transition; (c) cookie-banner CTA swap on the SAME geo suppresses with the consent reason; (d) phase 6: sg -> fr(suppressed, "—") -> fr(real "$149") never emits a "price restored from —" transition.
- `tests/offer-timeline.render.test.tsx` — suppressed entry renders as "Capture suppressed", not "First offer" and not a transition; proof hrefs kept.
- `tests/offer-timeline-agent-tools.test.ts` — MCP payload surfaces suppressed reason with changes null.
- `tests/offer-timeline.test.ts`, `tests/offer-timeline.server.test.ts` — green after the shape change (field populated automatically by `buildOfferLedger`).

No D1 migration (pure read-side ledger/diff logic + a test). No DROP COLUMN / DROP TABLE / column rename / NOT NULL.

## Verification

Real runs, on this branch, after rebase onto origin/main:

```
$ npx vitest run --project node tests/offer-timeline-geo-variance-phantom.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ npx vitest run --project node tests/offer-timeline.test.ts tests/offer-timeline.render.test.tsx tests/offer-timeline-agent-tools.test.ts tests/offer-timeline.server.test.ts
 Test Files  4 passed (4)
      Tests  42 passed (42)

$ npx vitest run --configLoader runner --project node
 Test Files  618 passed (618)
      Tests  7368 passed (7368)

$ npx vitest run --project workers
 Test Files  39 passed (39)
      Tests  198 passed (198)

$ NODE_OPTIONS="--max-old-space-size=8192" npx tsc -b
(exit 0; default-heap OOM on this large monorepo is resolved with the larger heap)
```

`run-proof:` the target regression suite `tests/offer-timeline-geo-variance-phantom.test.ts` ran on this branch post-rebase and went 4/4 green; four related offer-timeline suites (42 tests) green; full node project (618 files, 7368 tests) and workers project (39 files, 198 tests) re-ran green; `tsc -b` exits 0 with the larger heap. The regression test FAILS on current main (the pre-gate pair diffs to a phantom Headline/CTA/Price change) and PASSES with the gate — it is the `bin/prove-one-run-check` receipt run.

## Reviewer round (product repo, one round — seat cursor/cursor-grok-4.6-high)

Ran via step 8 before arming (`bin/fleet-review-arm-check` exit 0 → senior seat usable). Reviewer ran `npx vitest run --project node` on the five offer-timeline suites (46/46 green) and assessed the diff vs the issue acceptance.

Adjudicated against `~/.pi/agent/skills/review-adjudication/SKILL.md`:

- **Act on**: none — reviewer reported zero critical and zero warning findings.
- **Consider** (`"accept all"`/`"reject all"` are bare 2-word substrings with no cookie/consent context, a small genuine-CTA false-positive risk): NOTED, recorded, not re-delegated. The rest of the consent list is phrase-level and generic offer verbs ("Shop Now") are deliberately absent; the two bare phrases carry a minor risk that is within the issue's conservative prefer-never-fabricate scope. Documented in `.fleet/plan.md` as an accepted over-breadth tradeoff.
- **Consider** (geo-switch suppression permanently deafens the timeline to real new-region changes until the baseline is deliberately re-anchored): NOTED, recorded, not re-delegated. This is the phase-6 codified intended behavior (see `.fleet/plan.md` phase 6); re-anchoring the baseline on region adoption is the deeper fix the issue explicitly calls out of scope. `.fleet/plan.md` risk table records the decision.
- **Noted** (`geoLocaleSegment` treats any ISO-2 first path segment as a locale, e.g. `/in/`): harmless given the segment must match a real `SUPPORTED_COUNTRIES` code; not covered by tests.
- **Dismissed-with-reason** (conditional-`suppressedReason`/plain-paragraph render): back-compat call sites must keep compiling; proof hrefs are preserved and the suppressed state is explicit with a reason — exactly acceptance bullet 1.
- **Acceptance check** — all four bullets PASS.

The two Consider items are deliberate over-breadth tradeoffs of a conservative never-fabricate design, recorded here and in `.fleet/plan.md` as required, and are not re-delegated (manager mode: Consider/Noted are recorded, not acted-on).

## Acceptance

All issue bullets pass post-fix:
1. Capture-validity gate suppresses geo-locale-differing pairs + consent-CTA pairs as `capture_failed`-style suppressed states with a reason — never a transition.
2. Price `$149 -> —` disappearance suppressed when the only cause is the geo switch.
3. Regression test feeds the real sg+fr pair and asserts NO offer transition; a genuine same-geo price edit still emits exactly one transition.
4. Test fails on current main, passes with the gate.

`Closes #1996`