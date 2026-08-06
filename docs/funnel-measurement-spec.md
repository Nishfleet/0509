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

- Anonymous and account-scoped events covering the funnel: homepage view, search preview
  submit/result/error, signup start/complete, first watchlist, first proof, and paid
  conversion as a future read-only reconciliation metric.
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
workspace is identified; "account/workspace" means the event attaches to an opaque
server-generated account/workspace identifier.

| Event | Trigger | Purpose | Required fields | Forbidden fields | Scope |
|---|---|---|---|---|---|
| `funnel_home_view` | Homepage renders for a visitor | Count anonymous homepage reach | `event_id`, `timestamp`, `route` | All §4 forbidden fields | Anonymous |
| `funnel_search_preview_submit` | Visitor submits a public search preview | Measure anonymous search intent | `event_id`, `timestamp`, `route` | Query text, typed terms, `referrer` with query string | Anonymous |
| `funnel_search_preview_result` | Public search preview returns results | Measure search success | `event_id`, `timestamp`, `route`, `result_count_bucket` | Query text, result content, result URLs, ad creative text | Anonymous |
| `funnel_search_preview_error` | Public search preview fails | Measure search failure rate | `event_id`, `timestamp`, `route`, `error_kind` | Error message body, stack trace, provider response bodies | Anonymous |
| `funnel_signup_start` | Visitor begins signup (email magic link or OAuth) | Measure signup initiation | `event_id`, `timestamp`, `route` | Email, name, OAuth provider tokens | Anonymous (no PII, see §5) |
| `funnel_signup_complete` | Account becomes active (session created) | Measure signup completion | `event_id`, `timestamp`, `workspace_id` | Email, name, auth/session tokens | Account/workspace |
| `funnel_first_watchlist` | First watchlist is created in a workspace | Measure activation step 1 | `event_id`, `timestamp`, `workspace_id` | Watchlist query, competitor names, watchlist content | Account/workspace |
| `funnel_first_proof` | First successful proof capture completes | Measure activation step 2 | `event_id`, `timestamp`, `workspace_id` | Ad text, ad URLs, proof content | Account/workspace |
| `funnel_paid_conversion` | Plan transitions free → paid (read-only reconciliation) | Future metric; reconcile against existing `user_plan` records; never duplicates billing data | `timestamp`, `workspace_id` | Payment details, card data, invoice content, provider credentials | Account/workspace |

Notes:

- `funnel_paid_conversion` is a **future read-only reconciliation metric** only: it must be
  derived from existing `user_plan` records, not from payment instrumentation. It is listed
  now so the funnel contract is complete, but it is not part of the minimum v1 event set.
- Search preview events never record what was searched or what was shown — only coarse
  outcome signals (`result_count_bucket`, `error_kind`).
- Anonymous events must not be joinable to an identity through any stored field (§4).

## 4. Field allowlist

A future implementation may record **only** the coarse fields below. Anything not listed
is forbidden.

| Field | Meaning | Notes |
|---|---|---|
| `event_id` | Opaque server-generated event identifier | Generated server-side per event; unique; not derived from user input |
| `visitor_id` | Opaque server-generated stable identifier for anonymous events | Must be opaque, server-generated, and first-party only (see below) |
| `session_id` | Opaque server-generated coarse session identifier | Short-lived; not a tracking profile |
| `workspace_id` | Opaque server-generated workspace identifier | Only on account/workspace-scoped events |
| `timestamp` | ISO-8601 UTC time of event | Server clock, never client-supplied |
| `route` | Coarse route label from an allowlist (`home`, `search_preview`, `signup`, `activation`) | Never a full URL |
| `result_count_bucket` | Coarse bucket of search-preview result count (`0`, `1-10`, `11-50`, `51+`) | Never exact counts |
| `error_kind` | Coarse error class from an allowlist | Never error text or stack traces |
| `referrer_domain` | Coarse eTLD+1 of the referring site | Optional; never a full referrer URL |
| `account_scope` | `anonymous` or `workspace` | Derived server-side |

### Stable identifier rules

- A stable identifier (`visitor_id`) must be an **opaque server-generated identifier**
  (for example a random 128-bit value). It must never be derived from email, name, IP
  address, device, browser, or any fingerprint signal.
- It must never be used across unrelated sites or services. It exists only inside the
  0509 first-party runtime and dies with the retention period (§6).
- No third party ever receives it.

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
- **No cookie-based tracking by default.** Anonymous funnel measurement must not rely on
  persistent tracking cookies. `visitor_id`/`session_id` are server-side opaque values
  carried without new persistent client storage; the existing auth cookies are never
  used for measurement.
- **No-collection path.** Every product feature (homepage, search preview, signup,
  watchlists, proofs) works identically with measurement fully disabled. Measurement is
  an observational layer with no user-visible functional dependency; a visitor who opts
  out loses no product function.

## 6. Retention and deletion

- **Bounded retention.** Collected events are kept only for a bounded period, then
  deleted. **The exact final retention period is not owner-approved; it is an explicit
  decision gate** to be set by Nish before any implementation enables collection (a
  candidate default of 90 days exists but is not settled by this document).
- **Deletion with account.** When an account or workspace is deleted, all
  account/workspace-scoped funnel events for it are deleted in the same operation.
  Anonymous events are not linkable to an account and are deleted on the retention
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
   `funnel_search_preview_*`, `funnel_signup_start`) are written as structured JSON log
   records via the existing `app/lib/log.server.ts` mechanism (`operation: funnel_*`),
   which already redacts sensitive keys. This keeps anonymous pre-auth measurement out of
   any new database.
2. **Existing D1 records (existing, read-only).** Account/workspace-scoped activation
   metrics (`funnel_signup_complete`, `funnel_first_watchlist`, `funnel_first_proof`,
   `funnel_paid_conversion`) are derived from existing business tables
   (`user`, `user_plan`, `watchlist`, `proof_capture`, `evidence_usage_period`) by
   read-only aggregate queries, matching how `docs/ga-metrics.md` already infers the
   manual funnel. No migration or schema implementation is part of this PR.
3. **Query rules.** Production queries run read-only against production D1. No raw event
   export; aggregation thresholds per §6; no credentials in queries or outputs.

### Example aggregate questions (no credentials, no PII)

- How many anonymous `funnel_home_view` events per day, and what share reach
  `funnel_search_preview_submit`?
- What share of `funnel_search_preview_submit` events produce a `funnel_search_preview_result`
  with `result_count_bucket` ≥ 1, and what is the `funnel_search_preview_error` rate?
- What share of `funnel_signup_start` events reach `funnel_signup_complete` within the
  retention window?
- Median time from `funnel_signup_complete` to `funnel_first_watchlist`, and from
  `funnel_first_watchlist` to `funnel_first_proof` (derived from D1 timestamps).
- Free → paid conversion count per period (derived from `user_plan` transitions, read-only).

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
