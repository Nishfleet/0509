# First-Party Funnel Measurement Spec

Date: 2026-08-06
Branch: lane 1 (fleet 20260806)
Status: **Specification only. No collection is enabled by this document or by any change shipped with it.**

## 1. Status

This document specifies the minimum useful first-party measurement funnel for Five to Nine
(homepage → search preview → signup → activation). It is a specification and a decision
gate for future work; it enables nothing at runtime.

- No collection, logging, or instrumentation is added by this document.
- No environment variable, secret, migration, route, or worker change ships with it.
- The product retains its current no-third-party-analytics posture (see `docs/ga-metrics.md`).
- Nothing in this document constitutes consent by any user, and it cannot be used to infer
  consent later.

## 2. Scope and non-goals

### In scope

- Anonymous request-scoped events and account-scoped derived measures covering the
  funnel: homepage view, search preview submit/result/error, and signup start (emitted
  events); signup complete, first watchlist, first proof, and paid conversion (derived
  read-only metrics).
- The field allowlist that bounds what any future implementation may record.
- Consent, opt-out, Global Privacy Control (GPC), and no-collection behavior.
- Retention, deletion, storage, and read-only query rules.
- Rollout gates that must pass before any implementation is enabled.

### Explicit non-goals (never included)

- No third-party analytics SDK, pixels, beacons, or ad networks.
- No ad retargeting or ad-creative measurement.
- No cross-site tracking (no identifier is shared across unrelated sites or services).
- No fingerprinting (no browser/canvas/audio/UA-based identification).
- No session replay, heatmaps, or full-page captures of visitor behavior.
- No profiling, scoring, or behavioral advertising of visitors or users.
- No collection from pages or flows outside the funnel events listed in §3.

## 3. Event table

Events use the existing structured-JSON log operation style (`snake_case`, as in
`monitoring_fanout_scheduled`). The `funnel_` prefix reserves the namespace so funnel
events are distinguishable from operational logs. "Anonymous" means no account or
workspace is identified and the event is **request-scoped** (see §4); "account/workspace"
means the measure attaches to an opaque server-generated account/workspace identifier.
The account/workspace measures in §3.2 are **derived metrics, not emitted events**.

### 3.1 Emitted events (v1, anonymous, request-scoped)

| Event | Trigger | Purpose | Required fields | Forbidden fields |
|---|---|---|---|---|
| `funnel_home_view` | Homepage renders for a visitor | Count anonymous homepage reach | `event_id`, `timestamp`, `route` | All §4 forbidden fields |
| `funnel_search_preview_submit` | Visitor submits a public search preview | Measure anonymous search intent | `event_id`, `timestamp`, `route` | Query text, typed terms, `referrer` with query string |
| `funnel_search_preview_result` | Public search preview returns results | Measure search success | `event_id`, `timestamp`, `route`, `result_count_bucket` | Query text, result content, result URLs, ad creative text |
| `funnel_search_preview_error` | Public search preview fails | Measure search failure rate | `event_id`, `timestamp`, `route`, `error_kind` | Error message body, stack trace, provider response bodies |
| `funnel_signup_start` | Visitor begins signup (email magic link or OAuth) | Measure signup initiation | `event_id`, `timestamp`, `route` | Email, name, OAuth provider tokens |
| `funnel_migration_view` | The MagicBrief migration page (`/compare/magicbrief`) renders for a visitor | Count wind-down-intent reach for the migration blitz (`docs/magicbrief-blitz-capture.md`) | `event_id`, `timestamp`, `route` | All §4 forbidden fields |
| `funnel_signup_start_magicbrief` | Signup begins from a request whose URL carries the exact migration marker (`source=magicbrief-migration`), recognized server-side by exact string comparison against the allowlisted constant; the marker value itself is never stored | Measure wind-down capture at signup initiation | `event_id`, `timestamp`, `route` | Email, name, the raw `source` query value, referrer URL |
| `funnel_locale_segment_view_en` / `_de` / `_ja` / `_pt_br` | A sneaker-resale locale landing page renders | Count organic reach per locale page (issue 1154) | `event_id`, `timestamp`, `route` | Pathname, language headers, IP/geo, the raw URL |
| `funnel_signup_start_locale_en` / `_de` / `_ja` / `_pt_br` | Signup begins from a request whose URL carries the exact locale marker (`source=locale-<id>-sneaker-resale`), recognized server-side against allowlisted constants; the marker value itself is never stored | Measure locale-page capture at signup initiation | `event_id`, `timestamp`, `route` | Email, name, the raw `source` query value, referrer URL |
| `funnel_pricing_free_card_clicked` | Signup begins from a request whose URL carries the exact pricing Free card marker (`source=pricing-free`), recognized server-side against the allowlisted constant; the marker value itself is never stored | Measure whether surfacing the Free plan as a card on `/pricing` lifts free-tier click-through (issue 1499) | `event_id`, `timestamp`, `route` | Email, name, the raw `source` query value, referrer URL |
| `funnel_first_brief_viewed` | Authenticated Overview or Briefs renders a first brief with ≥1 evidence-linked item | Measure same-session activation (signup → first brief on screen) | `event_id`, `timestamp`, `route` | Watchlist names, ad URLs, proof content, `workspace_id` |

All v1 emitted events are request-scoped: they carry no identifier that
can join one request to another or connect them to an account (see §4). The two
MagicBrief blitz events follow every v1 rule unchanged: same field shape, same
default-off gate, same GPC suppression, no new identifiers. The attribution is a
coarse event-kind selection resolved on the server (the marker selects
`funnel_signup_start_magicbrief` instead of `funnel_signup_start`) — it never adds a
caller-controlled value to any record field, so anonymous events remain non-joinable.
`funnel_pricing_free_card_clicked` follows the same marker contract: the raw
`source=pricing-free` query value is compared to the allowlisted constant server-side
and never stored; like every signup-start variant it fires at signup submission with
`route=signup` and `account_scope=anonymous`.
`funnel_first_brief_viewed` uses `account_scope=workspace` and `route=activation` because
it fires after sign-in; it still stores no `workspace_id` and is not joinable to
`funnel_signup_start`.

### 3.2 Derived activation metrics (read-only, not emitted)

The account-scoped measures below are **not events**. They are derived by read-only
aggregate queries over existing business tables (see §7). They are never written to log
records and are never dual-logged alongside the events in §3.1.

| Measure | Derivation (read-only) | Purpose | Never includes |
|---|---|---|---|
| Signup completion | `user` rows (`created_at`) | Measure activation step 0 | Email, name, auth/session tokens |
| First watchlist | `watchlist` rows | Measure activation step 1 | Watchlist query, competitor names, watchlist content |
| First proof | `proof_capture` rows | Measure activation step 2 | Ad text, ad URLs, proof content |
| Paid conversion | `user_plan` free → paid transitions | Future metric; reconcile against existing `user_plan` records; never duplicates billing data | Payment details, card data, invoice content, provider credentials |

Notes:

- The paid-conversion measure is a **future read-only reconciliation metric** only: it
  must be derived from existing `user_plan` records, not from payment instrumentation. It
  is listed now so the funnel contract is complete, but it is not part of the minimum v1
  event set and is not emitted.
- Search preview events never record what was searched or what was shown — only coarse
  outcome signals (`result_count_bucket`, `error_kind`).
- Anonymous emitted events must not be joinable to each other, to an account, or to any
  identity through any stored field (§4).

## 4. Field allowlist

A future implementation may record **only** the coarse fields below. Anything not listed
is forbidden.

| Field | Meaning | Notes |
|---|---|---|
| `event_id` | Opaque server-generated event identifier | Generated server-side per event; unique; not derived from user input |
| `workspace_id` | Opaque server-generated workspace identifier | Only on account/workspace-scoped derived measures; never on anonymous events |
| `timestamp` | ISO-8601 UTC time of event | Server clock, never client-supplied |
| `route` | Coarse route label from an allowlist (`home`, `search_preview`, `magicbrief_migration`, `sneaker_resale`, `signup`, `activation`) | Never a full URL |
| `result_count_bucket` | Coarse bucket of search-preview result count (`0`, `1-10`, `11-50`, `51+`) | Never exact counts |
| `error_kind` | Coarse error class from an allowlist | Never error text or stack traces |
| `referrer_domain` | Coarse eTLD+1 of the referring site | Optional; never a full referrer URL |
| `account_scope` | `anonymous` or `workspace` | Derived server-side |

### Identity and join rules

- **v1 anonymous events are request-scoped.** No stored field identifies a visitor,
  links one request to another, or connects an anonymous event to an account. There is
  no `visitor_id` or `session_id` in v1, and no implementation may add one to this
  allowlist.
- **Multi-visit identity is out of scope.** Any future identifier meant to recognize a
  visitor across requests (for example a `visitor_id`, `session_id`, or any
  client-carried value) is a separate decision requiring explicit owner approval and a
  new spec change; the §8 rollout gates alone do not authorize it. Same-visitor
  conversion measurement would require such a join key and is likewise a future
  owner-approved decision, not part of v1.
- **If ever approved**, such an identifier must be an opaque server-generated value,
  never derived from email, name, IP address, device, browser, or any fingerprint
  signal. It must never be used across unrelated sites or services; it exists only
  inside the 0509 first-party runtime and dies with the retention period (§6).
- No third party ever receives identifiers.

### Explicitly forbidden fields (non-exhaustive)

- Raw email addresses or email-local parts.
- Names (first, last, display, handle).
- Free text of any kind (queries, notes, messages, search terms).
- URLs containing query strings, or full URLs of any kind (page URLs, result URLs,
  landing-page URLs, referrer URLs).
- Ad creative text, ad copy, ad images, or landing-page content.
- IP addresses and any IP-derived geo data.
- Precise location (coordinates, GPS, cell-tower/Wi-Fi-derived location).
- Auth/session tokens, cookies, credential material, OAuth codes or tokens.
- Payment details (cards, PANs, invoice data, amounts beyond the existing billing tables).
- Provider credentials and API keys (Meta access tokens, email provider keys, etc.).
- Browser fingerprints or fingerprint components (UA string, canvas, headers).
- Client-supplied timestamps or client-supplied identifiers (they are not trusted).

## 5. Consent and choice

- **Default-off.** No collection happens until all rollout gates (§8) pass, including
  owner approval. The code path for collection does not exist until then.
- **Consent.** If enabled, collection is limited to what §3–§4 allow and is disclosed on
  the public privacy surface before it starts. This document does not invent a legal
  compliance claim (no "GDPR compliant", "CCPA compliant", "consent-valid" statements).
  **Legal review is required before enabling collection.**
- **Global Privacy Control (GPC).** When the visitor's request carries a GPC signal, the
  implementation must treat the visitor as opted out and record nothing for anonymous
  events, and must suppress account-scoped funnel events for opted-out accounts.
- **Do Not Track (DNT).** DNT is a non-authoritative signal: it is not treated as a
  legally binding opt-out, and compliance must not be claimed from it. A future
  implementation may optionally honor DNT as a best-effort opt-out, but it must not be
  the basis of any legal claim.
- **No persistent client storage and no cross-request identity.** Anonymous funnel
  measurement must not rely on cookies, localStorage, or any new persistent client
  storage, and must not use fingerprinting. v1 anonymous events are request-scoped and
  carry no client-carried identifier (§4); the existing auth cookies are never used for
  measurement. Multi-visit identity is out of scope (§4).
- **No-collection path.** Every product feature (homepage, search preview, signup,
  watchlists, proofs) works identically with measurement fully disabled. Measurement is
  an observational layer with no user-visible functional dependency; a visitor who opts
  out loses no product function.

## 6. Retention and deletion

- **Bounded retention.** Collected events are kept only for a bounded period, then
  deleted. **The exact final retention period is not owner-approved; it is an explicit
  decision gate** to be set by Nish before any implementation enables collection (a
  candidate default of 90 days exists but is not settled by this document).
- **Deletion with account.** When an account or workspace is deleted, existing flows
  delete its business records; account/workspace-scoped measures are derived read-only
  from those records and leave no separate stored copy to clean up (§3.2, §7). Anonymous
  events are request-scoped, not linkable to an account, and are deleted on the retention
  schedule.
- **No raw export.** Raw events are never exported to docs, logs, support cases, or any
  deliverable. Aggregate answers may appear in docs only with the field allowlist intact
  and no identifiers.
- **Operator access.** Production queries are read-only (see §7). Operator access to raw
  events is restricted to authorized operators and only through aggregation thresholds
  (for example: no result cell with fewer than a minimum count is returned; raw events
  are never fetched individually for report purposes).

## 7. Storage and query plan

No new storage exists and none is authorized by this document. The plan for a future
implementation uses only existing surfaces:

1. **Structured JSON logs (existing).** Anonymous funnel events (`funnel_home_view`,
   `funnel_search_preview_*`, `funnel_migration_view`, `funnel_signup_start`,
   `funnel_signup_start_magicbrief`) are written as structured JSON log
   records via the existing `app/lib/log.server.ts` mechanism (`operation: funnel_*`),
   which scrubs values under credential-named keys (`secret`, `password`, `token`,
   `signature`, `cookie`, `authorization`, `api_key`, etc.). That scrubbing is narrow
   key-based redaction of credential material, not a privacy allowlist: the privacy
   controls are the §4 field allowlist and the redaction tests in §8. This keeps
   anonymous pre-auth measurement out of any new database.
2. **Existing D1 records (existing, read-only).** Account/workspace-scoped activation
   measures (signup completion, first watchlist, first proof, paid conversion; §3.2)
   are derived from existing business tables (`user`, `user_plan`, `watchlist`,
   `proof_capture`, `evidence_usage_period`) by read-only aggregate queries, matching
   how `docs/ga-metrics.md` already infers the manual funnel. They are never emitted or
   logged as events, so no dual-logged copy exists. No migration or schema
   implementation is part of this PR.
3. **Query rules.** Production queries run read-only against production D1. No raw event
   export; aggregation thresholds per §6; no credentials in queries or outputs.

### Example aggregate questions (no credentials, no PII)

- Daily count of `funnel_home_view` and of `funnel_search_preview_submit` events, and
  their ratio per day (time-bucket population rates; v1 does not measure same-visitor
  progression).
- Weekly counts of `funnel_migration_view` events — the week-over-week wind-down
  traffic measure for the MagicBrief blitz — and, in the same period, the count of
  `funnel_signup_start_magicbrief` next to total `funnel_signup_start` (the
  migration-attributed share of signup starts). These are independent request-scoped
  populations; no same-visitor join is performed or implied.
- Daily count of `funnel_search_preview_result` events with `result_count_bucket` ≥ 1
  and of `funnel_search_preview_error` events, and their ratio per day.
- Daily counts of anonymous `funnel_signup_start` events and of derived signup
  completion (from `user`), reported as independent populations; same-visitor
  start → complete conversion is not measurable in v1.
- Median time from signup completion to first watchlist, and from first watchlist to
  first proof (derived from D1 timestamps; §3.2).
- Free → paid conversion count per period (derived from `user_plan` transitions,
  read-only).

All v1 questions are answered from request-scoped event counts or read-only D1
aggregates. None require joining anonymous events to each other or to an account; any
future same-visitor conversion question would need a join key, which is a separate
owner-approved decision (§4).

## 8. Rollout gates

This document ships with the following gates **unpassed**. A future implementation is
enabled only when **all** pass:

1. **Privacy/legal review** — an actual legal review completes (this document claims no
   compliance).
2. **Owner approval** — Nish approves the implementation plan and the final retention
   period.
3. **Implementation PR** — a separate, explicitly approved implementation PR that adds
   only what this spec allows.
4. **Focused tests** — tests cover event emission, field allowlist enforcement, and
   opt-out/GPC suppression.
5. **Policy-surface parity review** — the public privacy/terms pages are updated, in a
   separately approved legal-copy change, to describe the measurement system before it
   activates (see §9).
6. **Redaction test** — a test proves no forbidden field can reach a log record.
7. **Retention/delete test** — tests prove bounded retention and account-deletion
   cleanup work.
8. **Post-enable canary** — after enablement, a short canary period with a rollback
   plan verifies the system before it is treated as operational.

**This PR passes none of the above gates. It only writes this specification.**

## 9. Review checklist against current surfaces

Truth recorded on 2026-08-06 against the repository at the base of this branch:

| Surface | Current truth |
|---|---|
| `docs/ga-metrics.md` | No third-party analytics SDK; approved mechanism is structured JSON logs via `app/lib/log.server.ts`; business metrics are read-only operator D1 queries; launch funnel is manual (inferred from auth tables); explicit ban on client-side tracking pixels without owner approval. |
| `app/routes/privacy.tsx` | Plain-English privacy summary. Discloses account details, saved searches, watchlists, collections, notes, reports, share links, delivery targets, Meta access settings, and operational logs; discloses the Site Rep public assistant and the Chrome extension's local-only behavior; explicitly disclaims unverified security/compliance claims (no SOC 2/HIPAA/GDPR claims). It does **not** mention a funnel measurement system, and it says nothing that authorizes one. |
| `app/routes/terms.tsx` | Plain-English operating terms: product status, billing, tracking-limit honesty, acceptable use, support. No mention or authorization of a measurement system. |
| Operational logs | Exist today as structured JSON records for operations (e.g., `monitoring_fanout_*`, `dodo_webhook_*`, `delivery_*`). These are operational, not funnel measurement, and this PR adds no new operations. |
| Analytics posture | No third-party analytics SDK anywhere in the app. |

**Conclusion:** the public legal surfaces do not yet authorize a new measurement system,
and the terms/privacy pages must be updated in a separately approved legal-copy change
before any collection is enabled. This PR changes no legal copy.

## 10. Implementation handoff

The future implementation:

- Must be a **separately approved** change; it cannot piggyback on this PR.
- Must **not infer consent** from this document or from any user behavior.
- Must **not activate collection** merely because this spec exists.
- Must follow §3 event semantics, §4 field allowlist, §5 consent rules, §6 retention,
  §7 storage/query plan, and pass all §8 gates.
- Must keep this spec as the source of truth for event definitions; any deviation is a
  new spec decision, not an implementation detail.
