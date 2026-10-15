---
title: e2e-production red on main
labels: agent-ready, critical-path
---

Run: {{ env.RUN_URL }}
Head: {{ env.SHA }}

Packet rule: read the failing specs in the run log above, then reproduce the failure on the local lane before changing code: `npm run e2e -- e2e/<name>.spec.ts` with `PLAYWRIGHT_TEST_BASE_URL` unset (wrangler dev --local, simulated email, local D1; AGENTS.md). The verify skill (.agents/skills/verify/) maps the failing specs to rows of .agents/skills/verify/feature-map.md. Do not dispatch `e2e-scheduled.yml` or hit https://0509.io to re-run: every production sign-in sends a real email and the run churns production D1. Production e2e runs only on its schedule, from main.
