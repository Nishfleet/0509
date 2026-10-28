# User reports: one door, designed twice

Decision record for #4226. Source claim: Lauren Tan, _2,500 PRs_, 10:33 (a vague
report arrives, the agent reads the feature map and drives the app) and 34:41
(routines subscribe to Slack and Sentry and reproduce automatically).

## What exists today

- Prometheus alerts dispatch `alert-repair@` units. Three ran on product alerts
  on 2026-09-22 (19:50 to 19:54 IST). Nothing a user says reaches the fleet.
- Email Routing on `0509.io` sends `support@0509.io`, `alerts@0509.io`,
  `fleet-signup@0509.io` and the catch-all to a Worker named
  `0509-support-inbox`, last modified 2026-07-03. It is the old app's bundle and
  is not in this repository. Nobody reads what it stores.

Corrected on 2026-10-28 (#5699). The live rules now bind `support@`, `brief@`,
`hello@` and `dmarc@` to `0509-support-inbox-v2`, and #5699 adds `alerts@` and
`fleet-signup@`. The catch-all is the one rule that cannot follow: wrangler's
catch-all update rejects a `worker` action, so unrouted mail still lands in the
dead bundle until it is moved through the Cloudflare REST API.

- Sentry is designed (`docs/REBUILD-TRUST.md` §A5) and parked on an org that
  only Nish can own (#4099).
- Every repository is public by decision (2026-09-17). A user's words cannot be
  pasted into an issue body.

## Candidate A: email first

`support@0509.io` routes to a small Email Worker in this repo. The Worker stores
the raw message in D1 (`support_report`: id, received_at, from_domain, subject
hash, raw MIME, 90-day expiry) and opens a GitHub issue that carries **only**
the report id, the receipt time, any `0509.io` paths found in the text, and the
user agent if the mail client included one. Labels `user-report` and
`machine-reported`. The reproducing worker reads the raw text with
`wrangler d1 execute 0509 --remote` and never copies it into the issue.

## Candidate B: Sentry first

#4099 lands. Sentry's GitHub integration opens the issue on a new error group;
support mail is forwarded into Sentry as user feedback so both arrive through
Sentry's door.

## Comparison

|                                    | A: email first                                        | B: Sentry first                                                        |
| ---------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Depends on Nish                    | no                                                    | yes, the org (#4099)                                                   |
| First real report end to end       | days                                                  | after the org exists and #3991 merges                                  |
| Public-repo privacy                | raw text stays in D1; issue carries an id             | Sentry holds it; issue carries Sentry's summary, which quotes messages |
| Covers reports with no stack trace | yes, that is most of them                             | poorly; feedback is a Sentry add-on                                    |
| Covers crashes nobody reports      | no                                                    | yes                                                                    |
| New machinery                      | one Worker, one table, one migration                  | none in the repo; two vendor integrations                              |
| Failure mode                       | mail lost if the Worker throws; Email Routing retries | silent if the integration token expires                                |

## Decision

**A now, B as the second source into the same issue shape once #4099 exists.**
A does not wait on anyone, handles the reports that actually arrive (text, not
traces), and keeps customer words off the public repo by construction. B is
better for crashes and worse for everything else; it joins later as a second
producer of `machine-reported` issues, not a second door.

Grafted from B: the issue carries a stable external id so a later Sentry event
and a support mail about the same failure can be linked by hand.

## The door, end to end

1. **Worker** `workers/support-inbox.ts` + `workers/support-inbox.wrangler.jsonc`,
   deployed by `deploy-production.yml` after the app smoke like the e2e inbox.
   `email()` handler: parse, store, open the issue via the GitHub REST API with
   a fine-grained token scoped to issues on this repo, stored as a Worker
   secret. No reply is sent to the user; replies stay with Nish.
2. **Routing**: the rules for `support@`, `brief@`, `hello@`, `dmarc@`,
   `alerts@` and `fleet-signup@` bind to `0509-support-inbox-v2`. They are
   written by the main-only `cloudflare-settings` job
   (`.github/workflows/cloudflare-settings.yml`, dispatched by hand), which
   updates a rule when it exists and creates it when it does not, so re-running
   it is safe. The catch-all is the exception: `wrangler email routing rules
update <zone> catch-all` rejects a `worker` action, so unrouted mail still
   lands in the dead bundle until someone moves it through the Cloudflare REST
   API.
3. **Admission**: `machine-reported` is never `agent-ready` on arrival. The 0509
   intake asks Jev `repro_worthy` with the issue body; p >= 0.9 adds
   `agent-ready`, p <= 0.1 closes with `not-actionable`, in between parks
   `needs-orchestrator`.
4. **Reproduction packet** (a section in `CLAUDE.md`): read the raw text from
   D1, map it to `.agents/skills/verify/feature-map.md` rows, drive production through the e2e
   helpers with the Access service token, and end with either a failing spec
   under `e2e/` or a no-repro proof citing what was tried. Nothing from the raw
   text goes into the PR.
5. **Proof of the program, run by hand**: send one real mail to
   `support@0509.io` and collect four receipts.
   1. Send the mail. Put `Probe <UTC date>` in the subject, for example `Probe
2026-11-04`. The body can say anything.
   2. A GitHub issue appears in `Nishfleet/0509`, titled `Support: <report
id>` and labelled `user-report` and `machine-reported`. The title carries
      the report id and nothing the sender wrote, because the repository is
      public.
   3. The mail arrives at `nishant345@gmail.com`, forwarded by the Worker.
   4. The row exists. Run one read against remote D1:
      `npx wrangler d1 execute 0509 --remote --command "SELECT id,
received_at, from_domain, subject_sha256 FROM support_report ORDER BY id
DESC LIMIT 3"`. The newest row is the probe.
      The stored count rises by one, and the daily sweep at 03:17 UTC logs that
      count, so the same fact is observable without running a command.

## Rejected

- Posting the mail body into the issue: public repo.
- Slack as the door: no Slack workspace for 0509 users exists.
- A Jev-written summary in the issue: Jev returns typed judgments, not prose.
- Re-using the old `0509-support-inbox` Worker: old-app bundle, no source here.

encoded: structure - one door for user reports that the intake cannot mis-admit
