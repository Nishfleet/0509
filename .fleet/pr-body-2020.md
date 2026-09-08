## What

Issue #2020: the public /search result page claimed universal "Across all
countries" coverage on the unscoped `country=all` default. The Meta Ad Library
API surfaces commercial ads only where they were delivered in the EU/UK, so
that headline overclaimed the served scope on the only free, account-free
first-value screen of the funnel.

This change renders an honest served-scope disclosure in the context line
under the /search H1 for the permissive `country=all` default instead of the
old overclaim:

> Commercial ads are shown only where Meta delivered them in the EU/UK

The H1 already names buyer intent ("What Nike is running on Meta", issue
#1502) — it never carried the country scope. The scope annotation that read
"Across all countries" is now the served-scope disclosure. The named-market
case stays unchanged ("In India", …). Both the mobile and desktop result views
render through the shared `WorkingHeader` context line, so the disclosure is
carried into both.

This is copy/scope only: it touches no data, no gates, no schema, no
migrations. Rollback is reverting the copy change.

## Research

The served-scope driver is the live Meta Ad Library API pipeline: the ad-fetch
layer queries `ad_reached_countries` against the Meta ads archive, whose
commercial coverage is delivery/EU-UK-gated (Research CONTEXT §2.4; the global
alternative is CAPTCHA/IP-blocked, ToS-adverse UI scraping, not a dependable
source). No `bin/` files added, so `research:`/`help-first:` via
`research-before-build-check` are N/A; the disclosure names the served scope
per the issue's acceptance ("otherwise default scope is set honest").

## Verification

`vitest run --project node` (whole node test project) — all green:

```
 Test Files  620 passed (620)
      Tests  7422 passed (7422)
 Duration   163.46s
```

Focused run of the touched/surrounding search suites — all green:

```
 Test Files  5 passed (5)
      Tests  151 passed (151)
```

The rendered /search regression test (`tests/search-qprefill-ssr.test.ts`)
asserts that for `country=all` the served-scope disclosure is present in the
SSR markup and the old overclaim ("Across all countries") is absent:

```ts
expect(markup).toContain(
  "Commercial ads are shown only where Meta delivered them in the EU/UK",
);
expect(markup).not.toContain("Across all countries");
expect(markup).not.toContain("across all countries");
```

`tsconfig.json` (app project) typechecks clean (`tsc --noEmit -p tsconfig.json`
→ exit 0). No new units, timers, path units, or GitHub workflows are added.

## run-proof

No new units/timers/workflows in this diff. Proof of a real run is the node
test project execution above (620 files / 7422 tests green) against these
changes.

net-positive-because: the honest disclosure reads longer than the two-word
overclaim it replaces and the added regression assertions (presence of the
disclosure + absence of the old claim) are the issue's acceptance test; no
logic is added beyond the copy swap, it is all test coverage and honest copy.

## Review

Reviewer seat: cursor/cursor-grok-4.6-high. One round over `origin/main...HEAD`
versus the issue acceptance and the repo tests. No critical (must-fix)
findings. Adjudication:

- **Consider — demo-source guard** (`search.tsx:1721` renders the disclosure
  over demo sample rows): not acted on. Demo is the preview fallback served
  only when neither the browser capture nor a Meta token is configured; the
  live account-free money-path serves real EU/UK-gated Meta commercial data,
  so the disclosure is truthful on that surface. Conveniently adding a
  demo-only exception would inject preview-state plumbing into the honesty
  fix for a surface the public funnel does not reach.
- **Act on — house voice, `served` → `delivered`** (`search-display.ts`):
  applied. "Where Meta delivered them" is plainer buyer language and still
  satisfies the issue's verify regex (`delivered` / `EU` are accepted tokens).
- **Noted — divergent all-countries phrasing on sibling surfaces**
  (`ads.$domain` "Meta's global ad library"): out of #2020 scope; each surface
  already keeps its own honest copy. No change.

Closes #2020