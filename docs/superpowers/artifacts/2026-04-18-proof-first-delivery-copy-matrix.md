# Proof-First Delivery Copy Matrix

This file is the canonical copy source for proof-first alert delivery in `0509`.

If product wording changes for alerts, templates, digests, or delivery-status UI, update this file first.

## Copy Rules

- Lead with what changed.
- Say how sure we are.
- Mention proof only when it exists.
- Keep customer language short, confidence-aware, and non-ambiguous.
- Never mention `Browser Run`, extractor internals, or provider jargon in customer copy.
- Do not send raw `proof_failed` language to customers.
- Use `Possible` only for rare provisional sends.
- Use `Confirmed` only when proof-backed or otherwise trusted by policy.

## Canonical Confidence Labels

| State | Customer label | Internal label |
| --- | --- | --- |
| `confirmed` | Confirmed | Confirmed |
| `detected` | Possible | Detected |
| `proof_pending` | Possible | Proof pending |
| `proof_failed` | Not customer-facing | Proof failed |
| `suppressed` | Not customer-facing | Suppressed |
| `invalidated` | Not customer-facing | Invalidated |

## Instant Email Families

| Family | Use when | Subject | Lead copy |
| --- | --- | --- | --- |
| `new_ad` | confirmed `ad_new` | `New ad from {competitor}` | `Confirmed: {competitor} launched a new ad on this watchlist.` |
| `ad_inactive` | confirmed `ad_inactive` | `Ad went inactive: {competitor}` | `Confirmed: a tracked ad from {competitor} is now inactive.` |
| `landing_page_url_changed` | confirmed `landing_page_url_changed` | `Landing page URL changed: {competitor}` | `Confirmed: {competitor} changed the landing page URL behind a tracked ad.` |
| `landing_page_content_changed` | confirmed headline / offer / CTA / form events | `{event_title}: {competitor}` | `Confirmed: {event_summary}` |
| `provisional_high_value` | rare customer provisional send | `Possible change detected: {competitor}` | `Possible: we detected a high-value change and verification is still running.` |

## Digest Email Families

| Family | Use when | Subject | Intro copy |
| --- | --- | --- | --- |
| `weekly_digest` | normal customer digest | `0509 weekly digest: {count} competitor changes` | `Here is what changed across your tracked competitors this week.` |
| `weekly_digest_empty` | optional future empty digest if ever enabled | `0509 weekly digest: no major changes` | `No major proof-backed changes were confirmed in this digest window.` |
| `internal_digest` | internal lane digest | `Internal digest: {count} monitoring events` | `Here are the latest monitoring outcomes, including provisional and failed proof work.` |

Digest item pattern:

- Title: `{event_title}`
- Meta line: `{watchlist_name} - {event_type_label}`
- Body: `{event_summary}`

## WhatsApp Template Families

Use template families, not freeform composition.

| Family | Lane | Use when | Body intent |
| --- | --- | --- | --- |
| `confirmed_instant_customer_v1` | customer | confirmed instant alerts | `{competitor} changed: {short_change}. Proof is ready. View details: {link}` |
| `confirmed_digest_customer_v1` | customer | basic WhatsApp digests | `{count} confirmed competitor changes this week. View details: {link}` |
| `provisional_customer_v1` | customer | rare provisional alert | `Possible change from {competitor}. Verification is still running. View details: {link}` |
| `internal_instant_v1` | internal | internal instant alerts | `{competitor}: {short_change}. Status: {status}. View details: {link}` |
| `internal_digest_v1` | internal | internal digests | `{count} monitoring events ready for review. View details: {link}` |

WhatsApp body rules:

- Keep it to one short claim plus one action.
- Prefer `changed` over more interpretive language.
- Do not stack multiple event narratives into one long message.
- For customer WhatsApp, mention proof only when the event is confirmed.

## Provisional Wording

Allowed customer provisional prefix:

- `Possible: we detected a high-value change and verification is still running.`

Allowed customer provisional detail lines:

- `Possible landing page change detected.`
- `Possible destination change detected.`

Do not use:

- `Confirmed`
- `Proof captured`
- `This definitely changed`

## Fallback Wording

Use these when the preferred channel cannot be used and another channel still can.

| Scenario | Customer-facing wording | Internal wording |
| --- | --- | --- |
| WhatsApp unavailable, email sent | `Sent by email.` | `WhatsApp skipped. Email sent instead.` |
| WhatsApp not opted in | not shown by default | `WhatsApp skipped: target not opted in.` |
| WhatsApp paused or opted out | not shown by default | `WhatsApp skipped: target paused or opted out.` |
| Email unavailable but another channel sent | `Delivered through another enabled channel.` | `Email skipped. Alternate channel sent.` |

## Blocked-Template Wording

Use this only in operator or internal status surfaces unless policy explicitly allows customer visibility.

| Scenario | Internal wording |
| --- | --- |
| template not approved | `WhatsApp blocked: template not approved.` |
| template not eligible for target | `WhatsApp blocked: target is not template-eligible.` |
| provider not configured | `WhatsApp blocked: provider not configured.` |
| customer WhatsApp rollout not ready | `WhatsApp blocked: customer rollout flag is off or provider readiness is incomplete.` |

## Delivery-Status UI Labels

Use these short labels in digest and watchlist status chips:

| Status | Label |
| --- | --- |
| `sent` | `Sent` |
| `failed` | `Failed` |
| `skipped_due_to_quiet_hours` | `Deferred` |
| `skipped_due_to_dedupe` | `Skipped duplicate` |
| `pending` | `Pending` |

## Why-Alerted Line

When a watch event card needs one short explanation, use this pattern:

- `Why you got this: {competitor} made a change that cleared your delivery threshold.`

When provisional:

- `Why you got this: this looks important enough to flag before verification finishes.`
