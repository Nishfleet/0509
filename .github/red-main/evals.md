---
title: evals red
labels: agent-ready
---

Run: {{ env.RUN_URL }}

The eval run failed. Read the failing step in the run log first. An `Authentication error [code: 10000]` on `/workers/subdomain/edge-preview` means the repository secret `CLOUDFLARE_API_TOKEN` cannot open the remote Workers AI session (docs/incidents/2026-10-14-evals-token-lost-scope.md). Do not dispatch `evals.yml` again to check a fix: each run spends Workers AI neurons.

If the log instead stops with `eval stopped: neuron ceiling` or `eval refused before any paid call`, the dispatched workload cannot fit the 2,000-neuron cap (0509#7249): narrow the dispatch with the `split` or `filter` input. The cap is a cost control, so raising it is not a fix for a red run.
