---
title: e2e-staging red on main
labels: agent-ready, critical-path
---

Run: {{ env.RUN_URL }}
Head: {{ env.SHA }}

Packet rule: read the failing specs in the run log above, then reproduce the failure on the local lane before changing code: `npm run e2e -- e2e/<name>.spec.ts` with `PLAYWRIGHT_TEST_BASE_URL` unset (wrangler dev --local, simulated email, local D1; AGENTS.md). The verify skill (.agents/skills/verify/) maps the failing specs to rows of .agents/skills/verify/feature-map.md. This suite runs against https://staging.0509.io, not production: never dispatch `e2e-scheduled.yml` with `journey` set or hit https://0509.io to re-run — every sign-in sends a real email and a journey run mints accounts for hours. A single spec dispatch (`spec:` input, any branch) against staging is allowed.
