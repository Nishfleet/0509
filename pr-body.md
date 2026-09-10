## What

`buildLlmsText` now requires ≥3 live Meta Ad Library ads (the same count already rendered in each llms.txt line) for a brand entry. One- and two-ad pages are the weakest possible citation to hand an answer engine and dilute the file's authority; the sitemap already down-weights them (priority 0.5-0.6).

Entries with no count (`adCount` undefined) are unaffected. The sitemap still lists 1-2 ad pages; only llms.txt drops them. converse/vans reappear automatically when their count grows.

## Verification

- `npx vitest run --configLoader runner --project node tests/public-markdown.test.ts` — 17 passed
- `npx vitest run --configLoader runner --project node tests/seo/llms-sitemap-reachable-sync.test.ts tests/llms-full.server.test.ts` — 18 passed
- `npx vitest run --configLoader runner --project node tests/sitemap.server.test.ts` — 91 passed
- `npx vitest run --configLoader runner --project node` — 659 files, 7884 tests passed
- `sgscan app/lib/public-markdown.ts tests/public-markdown.test.ts tests/sitemap.server.test.ts` — no new security findings

run-proof: full node suite green (7884 tests), sgscan clean

net-positive-because: product code change — a one-line filter in buildLlmsText plus the tests that pin the new ≥3-ad rule; the added lines are the test coverage that proves the behavior.

organ-heartbeat: app/lib/public-markdown.ts not-an-organ (product code, not a fleet organ)

Closes #2307
