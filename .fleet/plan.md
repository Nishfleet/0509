# Plan — Nishfleet/0509#2444 (M10 + M11, judge-edited spec)

- [ ] phase 1: M10 — deterministic RED test in tests/delivery-records-targets.test.ts (staggered-write stub, assert the read-back SQL binds targetValue); fix upsertDeliveryTarget to pass targetValue into listDeliveryTargets; keep Promise.all concurrent-variant test GREEN-only
- [ ] phase 2: M11 — test that concurrent first-time upserts of the same target both resolve (no UNIQUE 500); fix: INSERT OR IGNORE (pattern of provisionVerifiedAccountEmailTargetIfUnsuppressed), then re-read via getDeliveryTargetByUniqueFields and fall through to the existing update path
- [ ] phase 3: pattern sweep of the same read-back-without-value / plain-INSERT pattern in sibling files + green run of npx vitest run tests/delivery-records-targets*.test.ts (typecheck is the PR CI round-trip, per memory budget rule)
- [ ] phase 4: reviewer round on origin/main...HEAD, adjudication in PR body, PR opened and auto-merge armed
