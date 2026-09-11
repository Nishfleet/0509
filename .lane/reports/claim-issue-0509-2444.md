# Lane evidence — claim/issue-0509-2444 (phase 3)

- M11 test strengthened: tests/delivery-records-targets.test.ts now asserts COUNT(*) = exactly 1 delivery_target row after Promise.all concurrent first-time upserts.
- Pattern sweep of app/lib/data/ for (a) read-back-after-upsert omitting the value predicate, (b) read-then-plain-INSERT against a unique index:
  - app/lib/data/watchlist-site-pages.server.ts upsertWebsiteSiteScanPage (~line 460): pattern (b). Fix: INSERT OR IGNORE + changes===0 convergence through existing update path.
  - app/lib/data/watchlist-site-pages.server.ts upsertWebsitePageObservation (~line 724): pattern (b). Same fix.
  - customer-api-rooms upsertClientRoom create branch, delivery-records-attempts createDeliveryAttempt, digests createDigestRun, collections addAdToCollection: pattern shapes found but already convergent (catch→re-read→update path, changes===0 re-read, ON CONFLICT upsert) — no change.
  - Pattern (a): no instances beyond the phase-1-fixed upsertDeliveryTarget read-back.
- GREEN: tests/delivery-records-targets.test.ts 3 passed; watchlist-site-pages.server.test.ts + customer-agent-client-room-integration.test.ts 25 passed.
- Commit: 53dc90918 fix(delivery-targets): pattern sweep + M11 test strengthening
