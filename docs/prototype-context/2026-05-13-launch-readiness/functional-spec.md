# Functional Context

## Required Behavior

- Public homepage should invite pilot workspace creation, not claim full self-serve launch.
- Pricing display should come from Dodo local-price preview; checkout stays gated until Dodo 0509 product ids, test-mode checkout, and signed webhooks pass.
- Privacy and terms routes should be reachable from the public site.
- Same-URL Markdown negotiation should serve truthful Markdown for `/`, `/search`, `/privacy`, and `/terms`.
- `/llms.txt` should summarize current product truth for agents.
- Launch readiness should have a single command that runs local gates and the production canary.

## Key States

- Broad launch blocked: fresh discovery is degraded or cached.
- Pilot-safe: search and workspace exist, but delivery/payment claims stay narrow.
- Ready: production canary passes fresh live discovery and payment/delivery gates are verified.
