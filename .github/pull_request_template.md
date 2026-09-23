# Pull request

**Required when this PR touches `app/`, `workers/` or `e2e/`.** Run the
`verify` skill (`.agents/skills/verify/SKILL.md`) against the PR head, then
fill the section below: the CLI commands you ran and their pasted output.
`preview-assert` reruns the e2e suite on every PR and `e2e-production` and
`lighthouse` run after the deploy — none of them replaces a run you drove
yourself. A `## Verification` section that is prose rather than a run fails
review.

For a PR that touches neither `app/`, `workers/` nor `e2e/`, write
`not applicable: no app, workers or e2e change` and keep the rest of the body.

## Verification

Head SHA: <40-hex>

### Local

`npm run build` then `npx wrangler dev --local --port <per-process port>` (the
derivation in `playwright.config.ts`), then, with the daemon from
`npm run verify:start`:

````markdown
```bash
$ chrome-devtools new_page http://127.0.0.1:<port>/login
1: about:blank
2: http://127.0.0.1:<port>/login [selected]

$ chrome-devtools take_snapshot 2
<paste the a11y tree>

$ chrome-devtools emulate 2 --cpuThrottlingRate 4 --networkConditions "Slow 4G"
$ chrome-devtools performance_start_trace 2 --reload true --autoStop true --filePath trace.json.gz
<paste the summary: LCP with its TTFB / render-delay breakdown and CLS>

$ chrome-devtools performance_analyze_insight 2 NAVIGATION_1 LCPBreakdown
<paste the insight>

$ chrome-devtools list_console_messages 2
$ chrome-devtools list_network_requests 2
<paste both>
```
````

### Production (https://0509.io)

```bash
$ chrome-devtools new_page https://0509.io/
$ chrome-devtools take_snapshot 2
<paste the a11y tree>
```

Gated routes first need the Access service token exchanged for the
`CF_Authorization` cookie, the way `.github/workflows/ci.yml`'s `lighthouse`
job does. Never paste the token itself.

## Test plan

```
$ npm run lint
$ npm run typecheck
$ npm test
$ npm run e2e
```

## Notes

Anything the reviewer should weigh: what is not covered, what the run could not
exercise, and any follow-up issue filed for the rest.
