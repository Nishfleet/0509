# Guardrails: what we never do, what we keep, how a takedown works

Umbrella #3842. Author: Fable. Checked by the Opus deputy. Nish's decisions stand: we track brands and creators across the internet regardless of a platform's terms; paid data providers only with his yes; never his accounts or the fleet's logged-in sessions for collection.

## Who can be tracked

- Brands, companies, products, and creators who publish under a public handle or domain. The test is: does the subject present itself to the public for commercial or audience reasons.
- Never a private individual. A handle with no public commercial or audience presence is refused at onboarding with one line: "we track brands and creators, not people". Jev D7 (identity) carries a `public_subject` field; below 0.1 the input is refused, between it is asked.
- Never minors, never accounts marked private, never anything behind a login we would have to hold.

## What we collect and keep

- Public pages, public posts, public ad libraries, public feeds. Screenshots of public pages. No DMs, no private groups, no purchased personal data.
- Stored bodies on the `0509-snapshots` bucket follow this table. The platform deletes an object when its rule expires. Age expiry is not a cron and not a Worker. Expiry is day-granular, and Cloudflare typically removes an object within 24 hours of the day it expires, so the promise is the period in the table.

| Prefix       | What it holds                | Kept                 |
| ------------ | ---------------------------- | -------------------- |
| `mentions/`  | Feed bodies                  | 30 days              |
| `snapshot/`  | Raw page snapshots           | one year             |
| `shot/`      | Before-and-after screenshots | one year             |
| `card/`      | Standing-card artifacts      | 90 days              |
| all prefixes | Incomplete multipart uploads | aborted after 7 days |

- `0509-snapshots-backup` is the disaster-recovery copy of `0509-snapshots` (`wrangler.jsonc` binds it as `SNAPSHOTS_BACKUP`; the `snapshot-backup` Workflow fills it, copying every key the copy does not already hold). The first two hand-triggered instances of 2026-09-28 (`cf_b2ae3…` and `cf_281b0…`) listed 407 = copied 407, then listed 407 = copied 0 + present 407. The native `0 5 * * *` schedule registered on the Workflow produced no instance at the 2026-09-29T05:00Z and 2026-09-30T05:00Z binds (#6289, with the missed `mentions-sweep` and `site-sweep` binds of those days), and the nightly now starts from a Worker-level cron. Two instances have since started with no hand trigger: `snapshot-backup-2026-10-01T05-00-01-000Z` (created 2026-10-01T05:00:15Z, listed 414 = copied 7 + present 407; its id predates the current `snapshot-backup-<date>` naming, which `workers/workflow-crons.ts` has used since commit 5d4d2b6d7 of 2026-10-02; before it the id was the scheduled time with `:` and `.` replaced by `-`, from commit 759c35c06) and `snapshot-backup-2026-10-02` (created 2026-10-02T05:01:05Z, listed 473 = copied 59 + present 414, three pages). Both were read from the `backup-proof` job of `e2e-scheduled.yml` (run 37051740319, with the same output as the first read in run 37050178131; `wrangler workflows instances list` and `describe`); each was created within about a minute of 05:00Z with `Trigger: Binding`, which is what the Worker cron's `createBatch` shows (the logs cannot tell it from a hand `createBatch`), and both completed. The watchdog for a missed nightly is still open on #6289.
- The copy syncs no deletes: an account deletion or a "remove and forget" removes the copies in the same Workflow run (#5901), and a takedown touches rows and leaves the stored bodies where they are, so every other copy leaves the bucket by aging. Aging is a requirement, not yet a fact: the 2026-09-28 reads show the four per-prefix delete rules the table spells out on the source and only the `Default Multipart Abort Rule` on the copy (both reads pasted on #5950), so nothing in the copy expires until that issue lands. R2 counts age from each object's own creation, so a copied body would outlive the period the table promises; what the copy keeps for retention is an open call on #5901, not settled here.
- After a snapshot or screenshot passes one year, only the before-and-after marks and summaries remain.
- Mentions: the headline, URL, source, date, and the excerpt needed to show the mark. Never the full text of third-party posts.
- Jev verdicts and context packs: workspace-owned, deleted with the workspace.
- Own-site data (the user's own pages): same rules, plus incident records kept one year.

## Deletion

- Deleting a workspace deletes every owned row (ownership manifest) and every R2 object under its prefix, within one Workflow run, and stops every email. J14 in docs/REBUILD-DONE.md proves it. The same Workflow run also deletes those prefixes from `0509-snapshots-backup` (one step per prefix page, #5901); the copy's objects for other workspaces age out only by the copy's own rules, whose absence is the gap recorded in the retention section above (#5950).
- A user removing a competitor keeps history (product rule) unless they choose "remove and forget", which deletes that entity's signals for that workspace.

## Takedown

- Any brand or person can ask to be removed from tracking by any workspace, by email to the address in the footer. Handled within 72 hours by hand (Nish or the deputy), recorded on a `takedown` row with the subject, the date and the action. A subject on the takedown list is refused at onboarding and dropped from existing workspaces at the next tick, with a one-line note to the owner.
- Share images show only what docs/REBUILD-STANDING-CARD.md allows. They are rendered from live rows, so a subject is out of every share image made after its takedown is recorded.

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

- The takedown row is one row in the `takedown` table (`migrations/0009_takedown.sql`): the subject exactly as `entity.domain` holds it, the received time as `requested_at`, the time it was done as `actioned_at`, and the handler as `actioned_by`. It is never deleted.
- Recording it is one statement, and the database does the rest in the same transaction: every competitor row for the subject, in every workspace, becomes `dismissed` with `state_reason` `takedown` (what `app/lib/card/serve.server.ts` reads to drop the subject from a card), each affected owner gets the note on Alerts, and pending suggestions of it are dismissed. From then on no workspace can add, re-suggest or turn it back on, and onboarding refuses it.

```bash
npx wrangler d1 execute 0509 --remote --command "INSERT INTO takedown (subject, requested_at, actioned_at, actioned_by) VALUES ('example.com', '<received, UTC>', '<now, UTC>', '<handler>')"
```

- This is a production D1 write, so it needs Nish's yes (CLAUDE.md). The deputy may prepare it; Nish authorizes it.
- The note each affected owner sees: "<subject> asked to be removed from tracking, so we stopped tracking it."

### What the requester is told

- Done: "Done. <subject> is no longer tracked by any workspace on Five to Nine. We recorded your request on <date, UTC>."
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

A refused private-handle onboarding (recorded), a completed takedown round-trip on a test subject (row, timestamps, card re-rendered without it), a workspace deletion verified against R2 and D1 (the copy is not in that run; its objects stay until #5950 lands the copy's rules), and the R2 lifecycle rules visible in the Cloudflare dashboard for both `0509-snapshots` and `0509-snapshots-backup`, with `wrangler r2 bucket lifecycle list <bucket>` output pasted after each change — the artifacts P10.4 (docs/engines/guardrails.md:282) requires — owed for the copy, because the 2026-09-28 read found the source's five rules and only the `Default Multipart Abort Rule` on the copy (#5950 records the read, its credential and the missing rules).
