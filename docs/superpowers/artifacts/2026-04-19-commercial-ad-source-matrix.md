# Commercial Ad Source Matrix

This file is the operator-facing truth source for `0509` commercial-ad discovery.

## Current Provider Roles

- `meta_library_browser`
  - intended live provider for India commercial-ad discovery
  - should power public search and watchlist scans once fully wired
  - Browser Run-backed

- `meta_api`
  - diagnostic-only provider for this product use case
  - acceptable for:
    - political or issue-ad smoke tests
    - EU-delivered ad diagnostics
    - comparison during migration
  - not the primary live commercial source for India

- `demo`
  - local development and explicitly flagged demos only
  - not an acceptable silent production fallback

## Source Truth Rules

- A configured Meta token does not mean live commercial discovery is healthy.
- Production must surface live-provider degradation honestly.
- Cached live data is acceptable when the provider is degraded.
- Demo data is acceptable only when the mode is explicitly marked demo.

## Operator Questions

- If users see commercial ads in India, which provider produced them?
  - answer from the source resolver, not from token presence

- If a run fails, was it:
  - provider degradation
  - cache-only service
  - explicit demo mode

- If results are shown, are they:
  - live
  - cached live
  - demo
