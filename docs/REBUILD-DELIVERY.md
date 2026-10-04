# Delivery contract: what reaches the user, when, on which channel

Umbrella #3842. Author: Fable. Checked by the Opus deputy. Pairs with docs/REBUILD-JEV.md (which decides what is noteworthy) and the build brief (which decides how it looks).

## Principles

1. The product is calm. The default is: everything noteworthy lands in Alerts inside the app as it happens, and ONE email a week tells you where you stand. Nothing else interrupts.
2. Exactly one thing interrupts: your own site looks broken (D3s, p >= 0.5). That goes out within one Workflow tick, by email, and later by any channel the user adds.
3. An item is delivered once. Across channels, across weeks. Delivery is recorded per item per channel; a re-crawl or a re-run never re-sends.
4. Per-brand OFF is absolute: an off brand produces no alerts, no brief lines, no counts. Dismissed suggestions never appear anywhere.
5. Every message says what it is, why it was sent, and how to stop it, in one line at the bottom. One-click unsubscribe per channel. Sentence case, no exclamation marks (DESIGN.md voice).
6. Channels are rows in a `channel` table (email now; Slack, push, webhook later). Adding one is never a migration. Email goes through Cloudflare Email Service; nothing hand-rolled around it.
7. Both emails are transactional: each is triggered by one user's own subscription state and addressed to that user alone, with no marketing content. Cloudflare Email Service's terms cover transactional mail only, and the brief is designed to stay inside that line (no promotions, no broadcast lists, one recipient per message, unsubscribe honoured before the next send). If Cloudflare ever classifies the brief otherwise, the channel decision goes to Nish; nothing else changes.

Schema requirements (carried by the schema PR): a `delivery` record per item per channel per recipient, unique on that triple; an `incident` record per (workspace, page) with `opened_at`, `closed_at`, so "one open incident email per page per day" is a constraint, not a convention.

## Channels and cadence

| What                                             | In-app Alerts                  | Weekly brief (email)                                  | Immediate (email)        |
| ------------------------------------------------ | ------------------------------ | ----------------------------------------------------- | ------------------------ |
| Own-site breakage (D3s p >= 0.5)                 | yes, pinned until acknowledged | recap line                                            | **yes, within one tick** |
| Competitor site change, noteworthy (D3 p >= 0.9) | yes                            | yes, if it survives D4 or is the brand's biggest move | no                       |
| Competitor site change, possibly (D3 between)    | yes, low, "possibly"           | no                                                    | no                       |
| Mention, matters (D6 p >= 0.9)                   | yes                            | counted per brand; the top one quoted if D4 ranks it  | no                       |
| Mention, normal                                  | yes, behind the source pill    | counted                                               | no                       |
| Competitor added or retired by Jev               | yes                            | yes                                                   | no                       |
| Standing moved (rank change)                     | shown on Home, not as an alert | yes, the headline                                     | no                       |

Weekly brief: Monday, 08:00 in the user's timezone (from the browser at sign-up, editable in Settings). If nothing is noteworthy: it still sends, short, "quiet week", with the counts of what was checked. A brief is never skipped silently, because silence reads as "the product stopped".

## The weekly brief, in order

1. Headline: "You're #N of M this week", with the movement and the one sentence why (from D4's top reason).
2. Read this first: up to three before-and-after marks (D4), each with source, date, screenshot thumbnail, and a link to the item.
3. Per tracked brand, one line: biggest move, ad count delta, mention count delta, site changes count. Off brands are absent.
4. Your own site: "nothing broke" or the list of what did and whether it is still broken.
5. Footer: what was checked (sources and counts), when the next brief comes, and the unsubscribe line.

## Immediate alert (own site)

Subject: "<site> looks broken: <one-line kind>". Body: the before-and-after mark, when it was seen, what we will do next (re-check in N minutes), and a link. One email per incident; a re-check that finds it fixed sends a one-line "fixed" follow-up and closes the incident. Never more than one open incident email per page per day.

## Settings the user can change (and nothing more in v1)

- Brief day and time; timezone.
- Immediate alerts for own site: on (default) / off.
- Per-brand: tracking on / off (this is the same switch as everywhere else, not a second one).
- Email address for delivery (defaults to sign-in email).

## Proof required in every delivery packet

One real weekly brief sent to a real inbox from a real workspace, with the message id and timestamp, and one real own-site incident email with its "fixed" follow-up. Rendered HTML checked at 600 px and in a dark-mode mail client. No invented samples.

## Email sending capacity at launch (checked 2026-10-04, #6094)

Every email (magic links, the weekly brief, immediate alerts) goes through one Cloudflare Email Service account, so one daily cap covers all of them.

- **Daily cap.** Cloudflare publishes no number and no API returns it. The account's own send log (GraphQL `emailSendingAdaptiveGroups`, account `f670a698…`) shows the cap in practice: on 2026-09-28 sends stopped at 20:00 UTC after 5,978 delivered that UTC day, and nothing more went out until 2026-09-29. So the cap was about 6,000 sends per UTC day then. It rises with reputation. Normal use since the e2e fix: 51 to 186 sends a day (2026-09-29 to 2026-10-04).
- **Plan.** Workers Paid. `wrangler.jsonc` sets `limits.cpu_ms: 5000`, which only Workers Paid accepts, and `deploy-production.yml` deploys it green. Workers Paid includes 3,000 sends a month, then $0.35 per 1,000 (https://developers.cloudflare.com/email-service/platform/pricing/). 5 to 30 September used 16,729 (the log returns nothing older).
- **Sessions.** Magic link: 5 minutes, single use. Session: Better Auth default, 7 days, refreshed once a day when used (`app/lib/auth.server.ts` sets only `freshAge`).
- **Launch estimate.** Per customer, about one sign-in email and one brief a week. 1,000 customers is about 150 sends on a normal day and about 1,150 on Monday (briefs), well under 6,000. A month is about 8,700 sends, about $2 over the included 3,000.
- **Verdict.** The cap is enough for launch volume. No Limit Increase Request is needed. Production e2e is the only thing that has ever spent the cap (#6092, #6093). Request a raise from the form on https://developers.cloudflare.com/email-service/platform/limits/ when a normal day passes 3,000 sends.
