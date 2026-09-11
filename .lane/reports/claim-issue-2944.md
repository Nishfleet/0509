# Issue #2944 — Gate-B journey-2 mobile "entity context" flake

**Status: fix landed on `claim/issue-2944` (PR #2947); measurement hardened, gate unchanged.**

Branch: `claim/issue-2944`
Base: `origin/main` at `1f5a9ff0f`
Pull request: https://github.com/Nishfleet/0509/pull/2947

## Verdict: flake, not a layout regression

Per the issue's own procedure, diagnostic run `34598995470` (head `56f4e7e6`)
ran `Gate-B Journey 2: onboarding creates the first tracked competitor
(mobile)` to **pass in 3.4s**; `launch:readiness:predeploy` completed green on
that head. The same run failed much later in `verify-post-deploy-release.mjs`
(Gate C — different gate, different owner, untouched here).

`git log 264bcee3..d0ae8ec9 -- app/` shows no commit in the suspect window
touching the watchlist header, its CSS, the route's render, or the spec — the
issue's "deterministic spacing regression" hypothesis does not hold.

## Flake source and fix

`e2e/journey-2-release.spec.ts` read `entityHeading.boundingBox()` and
`entityContext.boundingBox()` in two separate `Promise.all` calls.
`boundingBox().y` is visual-viewport relative (the mobile-Chrome stale-offset
trap is already documented in `e2e/helpers/release-experience.ts`,
`layoutViewportY`), so an async reflow or a stale visual offset between the two
reads mixes two layout states into one "gap". Run `34595877209` measured
58.8125px where the settled layout is ~17.8px — the extra ~41px is an
inter-read shift, not a real position. This family of flake is known here:
PR #647 fixed the same Google Fonts `media=print→all` swap as a hydration
flake.

The fix waits for pending webfonts (`document.fonts.status === "loaded"`),
then reads both `getBoundingClientRect()` values inside **one synchronous
`page.evaluate`** — both box edges always come from a single settled layout
pass. Assertion count, the 48px threshold, and the assertion message are all
unchanged; `GATE-B entity context gap=<n>` is logged for run-proof.

## Verification (this worktree, head `be62a136c`)

```
node scripts/run-local-release-proof.mjs --journeys=2 --diagnostic-subset
  7/7 pass, exit 0 — mobile onboarding test 6.1s
  log line: GATE-B entity context gap=17.8125
E2E_START_LOCAL_SERVER=1 playwright test ... -g "first tracked competitor (mobile)"
  1/1 pass, 5.3s, gap=17.8125
npx vitest run --configLoader runner --project node --changed origin/main
  no affected unit tests (spec-only diff), exit 0
sgscan --base origin/main   No new security findings, exit 0
```

measured-gap: 17.8125px (< 48px required).

crgate: NOT RUN — `crgate` exited 3, "CodeRabbit is not signed in on this
machine". The local gate is missing on this PR; sgscan ran clean and CI +
reviewer round still gate the change.
