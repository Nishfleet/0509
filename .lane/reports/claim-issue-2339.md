# Lane evidence: claim/issue-2339

Consolidate digest channel renderers into digest-render.server.ts.

## Changes
- Created `app/lib/digest-render.server.ts` with the three digest channel
  renderers (renderDigestEmail, renderDigestSlackText, renderDigestTeamsText)
  plus the shared renderDigestChatText helper.
- `app/lib/delivery.server.ts` imports the three renderers from the new
  module; removed the definitions and now-unused imports
  (readDigestIntelligence, adChurnFootnoteLine, rerankDigestBrief,
  formatDate, buildDigestEmail value import — kept as type-only).
- `tests/digest-chat-ranking.test.ts` imports the renderers from the new
  module; DigestDeliveryItem type still from delivery.server.

## Verification
- `npx vitest run --project node tests/digest-chat-ranking.test.ts tests/digest-email.test.ts` → 93 passed
- `npx vitest run --project node tests/delivery.server.test.ts tests/digest-delivery-claims.test.ts ...` → 75 passed
- `npx vitest run --project node tests/instant-alert-delivery-claims.test.ts ...` → 40 passed
- delivery.server.ts: 4519 → 4365 lines (154 removed)
