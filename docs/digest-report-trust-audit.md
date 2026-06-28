# Digest, Report, And Delivery Trust Audit

Date: 2026-06-29 IST
Branch: `codex/digest-report-trust-hardening-20260628`

## Verified Baseline

- Started from synced `main` and created the requested branch.
- Baseline `npm test`, `npm run typecheck`, `npm run build`, D1 backup validation, local D1 migration listing, and production-safe canaries passed before behavior edits.
- Cloudflare Email official docs show Worker `send()` returns provider send metadata such as a message id. Cloudflare lifecycle docs distinguish provider accepted/sent from delivered. This means `EMAIL.send()` success is not recipient delivery proof.

## Digest Pipeline

- `workers/schedule.ts` resolves daily and weekly digest schedules.
- `workers/app.ts` calls `runScheduledMonitoring`.
- `app/lib/monitoring.server.ts` creates digest runs and digest items, then calls delivery.
- `app/lib/delivery-policy.server.ts` decides which watch events can enter customer digests.
- `app/lib/change-intelligence.ts` adds priority, recommendation, proof trail, and `sourceStatus`.
- `app/lib/delivery.server.ts` resolves delivery targets, renders email, sends via Cloudflare Email, and records attempts.
- `app/routes/app.digests.tsx` renders digest history, selected digest detail, share/export actions, and delivery status.

## Report And Export Pipeline

- `app/routes/app.reports.tsx` builds collection and watchlist reports.
- `app/lib/report-builder.server.ts` maps every supplied watch event into report rows.
- `app/routes/share.$token.tsx` renders live share links and report snapshots.
- `app/routes/export.$resourceType.$resourceId.tsx` and `app/lib/resource-export.ts` serialize watchlist and digest exports.
- `app/routes/api.v1.$resourceType.$resourceId.ts`, `app/routes/api.mcp.ts`, and customer-agent report actions also consume raw watch event lists.

## Verified Gaps

1. Digest email is an activity dump, not a decision brief. It groups every item by watchlist, has no top-three cap, no authored text alternative, no source coverage note, and no strong full-detail CTA.
2. Digest wording overclaims proof. Several surfaces say proof-backed even when an item can be scan-spotted or provisional.
3. Cloudflare Email send success is written as `deliveredAt` and then shown as delivered on some customer surfaces, even though it only proves provider acceptance.
4. Launch readiness checks general email attempts instead of requiring a digest-specific email attempt.
5. Reports, exports, API output, MCP output, and agent report creation trust raw watch events. Suppressed, invalidated, proof-failed, internal, canary, and scan-only rows can leak if they exist in `watch_event`.
6. Public digest share snapshots store the full digest record, including private delivery and internal identifiers.
7. Report rows lack first-class proof status, source type, source link, capture timestamp, and source coverage/exclusion counts.

## Implementation Direction

- Add one shared proof/report eligibility policy and use it in reports, exports, and digest presentation.
- Keep Cloudflare Email status as provider accepted/sent-to-provider, never recipient delivered.
- Make digest email a concise top-three decision brief with authored plain text.
- Make app digest and report pages carry the full detail and labels while keeping delivery health after content.
- Sanitize digest share snapshots instead of publishing raw digest records.
