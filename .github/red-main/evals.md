---
title: evals red
labels: agent-ready
---

Run: {{ env.RUN_URL }}

The eval run failed. Read the failing step in the run log first. An `Authentication error [code: 10000]` on `/workers/subdomain/edge-preview` means the repository secret `CLOUDFLARE_API_TOKEN` cannot open the remote Workers AI session (docs/incidents/2026-10-14-evals-token-lost-scope.md). Do not dispatch `evals.yml` again to check a fix: each run spends Workers AI neurons.
