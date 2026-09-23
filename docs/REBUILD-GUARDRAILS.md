# Guardrails: what we never do, what we keep, how a takedown works

Umbrella #3842. Author: Fable. Checked by the Opus deputy. Nish's decisions stand: we track brands and creators across the internet regardless of a platform's terms; paid data providers only with his yes; never his accounts or the fleet's logged-in sessions for collection.

## Who can be tracked

- Brands, companies, products, and creators who publish under a public handle or domain. The test is: does the subject present itself to the public for commercial or audience reasons.
- Never a private individual. A handle with no public commercial or audience presence is refused at onboarding with one line: "we track brands and creators, not people". Jev D7 (identity) carries a `public_subject` field; below 0.1 the input is refused, between it is asked.
- Never minors, never accounts marked private, never anything behind a login we would have to hold.

## What we collect and keep

- Public pages, public posts, public ad libraries, public feeds. Screenshots of public pages. No DMs, no private groups, no purchased personal data.
- Stored bodies on the `0509-snapshots` bucket follow this table. The platform deletes an object when its rule expires. Age expiry is not a cron and not a Worker. Expiry is day-granular, and Cloudflare typically removes an object within 24 hours of the day it expires, so the promise is the period in the table.

| Prefix | What it holds | Kept |
|---|---|---|
| `mentions/` | Feed bodies | 30 days |
| `snapshot/` | Raw page snapshots | one year |
| `shot/` | Before-and-after screenshots | one year |
| `card/` | Standing-card artifacts | 90 days |
| all prefixes | Incomplete multipart uploads | aborted after 7 days |

- After a snapshot or screenshot passes one year, only the before-and-after marks and summaries remain.
- Mentions: the headline, URL, source, date, and the excerpt needed to show the mark. Never the full text of third-party posts.
- Jev verdicts and context packs: workspace-owned, deleted with the workspace.
- Own-site data (the user's own pages): same rules, plus incident records kept one year.

## Deletion

- Deleting a workspace deletes every owned row (ownership manifest) and every R2 object under its prefix, within one Workflow run, and stops every email. J14 in docs/REBUILD-DONE.md proves it.
- A user removing a competitor keeps history (product rule) unless they choose "remove and forget", which deletes that entity's signals for that workspace.

## Takedown

- Any brand or person can ask to be removed from public standing cards and from tracking by any workspace, by email to the address in the footer. Handled within 72 hours by hand (Nish or the deputy), recorded on a `takedown` row with the subject, the date and the action. A subject on the takedown list is refused at onboarding and dropped from existing workspaces at the next tick, with a one-line note to the owner.
- Public standing cards show only what docs/REBUILD-STANDING-CARD.md allows; a takedown removes the subject from every card on the next render.

### Who reads it

- support@0509.io is the address in the footer and on /privacy. Email Routing hands it to the `0509-support-inbox` Worker, which stores it and forwards it to Nish's Gmail (#4310). Nish reads it there. He may ask the deputy to draft the reply and the record; Nish sends the reply and authorizes the write.

### The 72-hour clock

- The clock starts when the message reaches support@0509.io (its received time), not when someone opens it. Weekends count.
- Within 72 hours the requester has one of three replies: done, refused, or a request for the missing detail. The wording for each is below.

### What a request must contain

- The subject: a domain (`example.com`) or a public handle and its platform.
- Who is asking: the brand or creator, or someone who says they act for them. We do not ask for ID.
- If either is missing, reply once within 72 hours: "To remove this we need the domain or public handle, and who you are in relation to it. Reply with both and we will handle it within 72 hours of your reply." The clock restarts on their reply.

### Recording it

- The takedown row is every `entity` row whose domain is the subject, in every workspace, set to state `dismissed` with `state_reason` `takedown`, `state_changed_by` the handler and `state_changed_at` the time it was done. That is what `app/lib/card/serve.server.ts` reads to drop the subject from a card.
- This is a production D1 write, so it needs Nish's yes (CLAUDE.md). The deputy may prepare it; Nish authorizes it.
- Each affected workspace owner gets the one-line note at the next tick: "<subject> asked to be removed from tracking, so we stopped tracking it."

### What the requester is told

- Done: "Done. <subject> is no longer tracked by any workspace on Five to Nine and no longer appears on any public standing card. We recorded your request on <date, UTC>."
- Refused: we refuse only when the request is about a subject the requester neither is nor says they act for. "We can't act on this request. We remove a brand or creator when they, or someone acting for them, ask. This request is about <subject>, and it does not say you act for them. If you do, reply saying so and we will handle it within 72 hours of your reply."

### No machinery

- No form, no ticketing tool, no automation. A handful a year, handled by hand.

## Collection conduct

- Rate limits per source live in the source registry, honoured by the Workflow, never by a sleep loop in code. A source that blocks us is marked degraded in the UI, not retried harder.
- Robots.txt is honoured for plain fetches of the user's own site and for blog/RSS discovery. For competitor public pages the decision is Nish's (2026-09-21): we fetch what a browser would show a logged-out visitor, through Browser Rendering, at the registry's rate.
- Identities used for collection: dedicated, disposable, created per the standing rule, stored in Nish's credential store, never in the repo. Egress from Cloudflare or the VPS only.
- Paid data providers: none until Nish approves the provider and the monthly cost; the approval and the cost line are recorded on the source registry row.

## What the footer says

Privacy and terms pages exist from day one, plain words, matching this document: what we collect, how long, how to be removed, who to email. No claim on any public surface that this document does not back.

## Proof required

A refused private-handle onboarding (recorded), a completed takedown round-trip on a test subject (row, timestamps, card re-rendered without it), a workspace deletion verified against R2 and D1, and the R2 lifecycle rule visible in the Cloudflare dashboard.
