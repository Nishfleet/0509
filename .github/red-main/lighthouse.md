---
title: lighthouse red on main
labels: agent-ready, critical-path
---
Run: {{ env.RUN_URL }}
Head: {{ env.SHA }}
Report: {{ env.LINKS }}
Budgets: lighthouse-budget.json

Feature-map row (.agents/skills/verify/feature-map.md): `/`, the audited URL.

Packet rule: reproduce the failure with the verify skill (.agents/skills/verify/) against https://0509.io before changing code, and paste that run in the PR.
