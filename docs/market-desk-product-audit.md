# Market Desk Product Audit

Date: 2026-06-30

## Summary

Five to Nine already has the raw machinery for a competitor operations desk: Dodo pricing, Better Auth, watchlists, Presence website tracking, proof capture, digests, reports, client rooms, API/MCP, support cases, and delivery canaries. The product gap is activation: the first paid path still feels like separate features instead of one Market Desk setup that produces a useful brief.

## Journey Findings

| Step | Customer expects | Current behavior | Gap | Fix direction |
| --- | --- | --- | --- | --- |
| Pricing | Pick a plan and understand capacity | Dodo-backed localized pricing is live; billing canary passed | Plan capacity does not directly lead into competitor setup | Keep pricing as source of truth, then route paid customers into Market Desk setup |
| Signup | Email-link sign-in and direct first value | Better Auth sends signup to `/app/onboard` | The onboarding copy says "one competitor" | Make bulk competitor paste the primary path |
| Onboarding | Paste competitors, review, create desk | `/app/onboard` accepts one website and optional brand site | No batch paste, CSV, dedupe table, or over-cap chooser | Add bulk parser/review flow with plan-cap awareness |
| Competitor setup | Validate/normalize domains and names | `normalizeCompetitorWebsiteInput` handles one URL/domain safely | Names, notes, CSV rows, duplicates, and invalid-row review are missing | Add a pure competitor-list parser and preview state |
| Search | Get an answer, not only ad cards | `/search` runs public/auth search and Search V2 domain matching | No route-level answer summary; user must inspect cards | Add search answer helper and panel |
| Watchlists | Competitors become retained monitoring | `createWatchlist` queues first scan; plan limits enforced | Bulk creation and partial success states are missing | Create selected valid rows; report skipped/duplicate/over-cap rows |
| Presence | Website presence is created where entitled | Presence website tracking is generally available, separate page | Setup does not connect competitor websites to Presence first value | Add a truthful setup next action and use existing Presence paths; do not invent source proof |
| First proof | See what changed and proof status | Watchlist events, proof captures, first-scan polling, and proof classification exist | No workspace-level first-session brief | Add derived Market Desk Brief over watchlists, events, proof, source status, and queued state |
| Digest | Retention loop begins | Digests and all-quiet heartbeat exist | Dashboard leads with setup/readiness before Market Desk outcome | Make dashboard first panel the Market Desk Brief |
| Report | Package proof for a client or team | Report builder and exports exist | No first-brief-to-report handoff | Surface report/client-room CTA from the brief when proof is ready |
| Client room | Agency handoff | Client rooms exist | Setup does not group imports by client/tag | Support optional CSV tags/client column and suggest room/report |
| Notifications | Delivery is understandable and safe | Email is verified; Slack/WhatsApp dormant; delivery attempts tracked | Some setup states still feel operational | Keep copy customer-facing: Notifications, Digest, Report |
| Billing | Self-serve trust clarity | Billing portal/canary/support fallbacks exist | Portal setting truth remains config-dependent | Keep support fallback where provider setting is not proven |
| Developer access | Agents help keep desk ready | API/MCP and customer actions exist | Customer promise is buried in technical copy | Frame as Developer access and approved actions |
| Support | No email-only dead ends for common actions | Support cases and account deletion request exist | Import migration still needs self-serve path | Build generic import; document unsupported MagicBrief fields |

## Time To Value

Current first paid value can be quick for one competitor, but high-intent users with 3, 10, or 75 competitors hit one-by-one setup. The target is:

1. Paste or upload competitors.
2. Review valid, duplicate, invalid, and over-cap rows.
3. Create watchlists and queue first scans.
4. See a Market Desk Brief immediately with ready, queued, all-quiet, or not-enough-data state.
5. Continue to report, collection, digest, notification, client room, or developer access.

## Dead Ends And Unclear Copy

- "Start with one competitor site" conflicts with the paid Market Desk promise.
- Free-plan users need a direct paid upgrade path, not a zero-watchlist confusion state.
- Search results explain individual ads, but not the answer a buyer came for.
- Presence is visible as a separate feature, not as source coverage in the desk.
- API/MCP language is too internal for the primary customer journey.

## Manual Or Support Dependencies

- Full MagicBrief data migration cannot be claimed without a real export sample and field support.
- Presence local canary needs owner-provided `PRESENCE_INTERNAL_WORKSPACE_ID`.
- Dodo dashboard portal toggles should remain described via current config/fallback truth.
- Slack, WhatsApp, X, Reddit, and LinkedIn should remain disabled or held in customer-facing setup until separately proven.

## Acceptance Direction

The first screen after setup should answer:

- What changed?
- Why does it matter?
- How proven is it?
- Where did it come from?
- What should I do next?

When that cannot be answered yet, the product should say exactly why: queued scan, not enough public data, no verified ads, source unavailable, plan cap reached, import needs review, or support needed.
