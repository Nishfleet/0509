---
title: e2e-production red on main
labels: agent-ready, critical-path
---
Run: {{ env.RUN_URL }}
Head: {{ env.SHA }}
Artifact: playwright-report-production on that run

Packet rule: reproduce the failure with the verify skill (.agents/skills/verify/) against https://0509.io before changing code, and paste that run in the PR. The verify skill maps the failing specs to rows of .agents/skills/verify/feature-map.md.
