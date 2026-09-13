# claim/issue-3166 — evidence record (2026-09-13)

Guard shipped: `scripts/canary-sitemap-coverage.mjs` + `.github/workflows/sitemap-coverage-canary.yml`
+ `public-brand-page` canary-token exemption + 20 node tests + 3 workerd integration tests.

Recorded runs (this lane, 2026-09-13):
- Live probe `node scripts/canary-sitemap-coverage.mjs --json`: **advertised 197, ok 197, divergences 0, exit 0 (GREEN)** against https://0509.io — observe-to-close green recorded while production healthy.
- Fixture 404 drill (`--input` 3-URL sitemap, live base): verdict FAILED, 1 divergence — `/guides/zzz-3166-drill-does-not-exist` → `http-404` — the divergence-class catch demonstrated. (Pipe to `tail` masked the drill's own exit — the fleet-ops#1193 class; exit-1 behavior is test-locked in the node suite.)
- Tests: node project (affected, `--changed origin/main`): 791 files / 10058 tests green; workers project: 3/3 (real workerd + edge RL bindings + D1 from repo migrations: 140-URL token sweep, anon budget isolated, wrong token 429).
- Superseded drill (prior incarnation, recorded in 613b1277f): 183 URLs, 14×http-429 on the /ads+/timeline brand tail — the class the token exemption fixes.

Chain state (acceptance 1, live 2026-09-13): newest `deploy-production.yml` success remains d16b1f000 2026-09-09T17:03:16Z; 2026-09-13 runs 11:12Z / 11:58Z / 12:21Z (a4d650cf) all conclusion=failure — 3 failing `prod-public` e2e specs (product page tablet+mobile widths, submit-without-side-effects) trip the post-deploy smoke → auto-rollback → exit 1. Production nevertheless serves all 197 advertised URLs 200 (guard-green above), so the #3166 404 class is closed; the chain-red is a separate, pre-existing defect.
