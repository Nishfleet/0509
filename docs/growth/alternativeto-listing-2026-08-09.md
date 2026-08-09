# Five to Nine AlternativeTo listing packet — 2026-08-09

Lane 1 packet: "Prepare a manual AlternativeTo listing for Five to Nine
[research-desk 2026-08-08, risk: green] [traction]" (backlog owner:
`/home/nish/workspaces/agent-state/0509-improvement-loop/backlog.md`).

Status: **prepared, agent-execution blocked by venue policy — AlternativeTo
is a human submission venue (account + email verification + review backlog),
so the submission itself is the account owner's manual step below.** The
agent-completable half is done here: baseline absence verified live with
browser proof, official venue policy re-verified live, approved copy
finalized, machine gate receipts captured, and the exact resume path
documented.

## Baseline evidence (verified live 2026-08-09, browser proof)

- On-platform search for `five to nine`
  (`https://alternativeto.net/browse/search/?q=five+to+nine`) returns only
  unrelated fuzzy matches — Fliki, Ninimaths, Pinboard, Every File Explorer,
  TheFile.Ninja, Lime Files, ROM Properties page shell extension, OST
  Converter Tool, Vole Windows Expedition, MeinPlatz, EasyOnTheEyes, AppEven,
  Schematica, FinetuneDB, Go HTTP File Server (page 1; pagination continues).
  None is Five to Nine; none links to `0509.io`.
- On-platform search for the unique handle `0509`
  (`https://alternativeto.net/browse/search/?q=0509`) returns five unrelated
  certificate/security tools (Smallstep Certificates, PortableSigner,
  showcert, Cert Decoder, OpenXPKI). Five to Nine has no AlternativeTo page.
- curl to `alternativeto.net` is bot-walled (Cloudflare challenge, per prior
  scout runs 2026-08-09), so browser snapshots are the evidence. Live
  verification performed with the Camoufox browser 2026-08-09 ~23:20 IST.
- The canonical homepage `https://0509.io` returns HTTP 200 with title
  "Five to Nine | Know when competitors change the offer" and meta
  description "Five to Nine watches competitors&#x27; Meta ads and landing
  pages, then sends screenshot evidence and change alerts before your next
  meeting." — the claims below trace to this surface.

## Official venue policy evidence (re-verified live 2026-08-09)

Source: `https://alternativeto.net/faq/` (checked with the browser this run).
Relevant, verbatim:

- Add a new application: "You can add your software by using the option
  'Suggest new application' that you can find clicking on the User icon in
  the top right corner. Then you have to fill the fields Platforms, License,
  Descriptions, Tags, etc. and click the button 'Submit the application'.
  Your app then goes into our review backlog — see How long does it take to
  get my app reviewed?"
- Account gating: "You need to verify your email address before you can
  submit a new app — this is to discourage spammers and bots. Voting,
  commenting and editing existing apps work as soon as you sign up."
- Review queue: submissions go into a review backlog. Optional one-time $5
  "Priority review" moves a submission to the front of the queue (usually
  reviewed within 1–2 business days), and "Paying moves you up the queue —
  it does not buy approval." There is a free path through the normal review
  backlog; priority review is optional and payment-walled, so it is a
  NEEDS-NISH decision, not something an agent may purchase.
- "Can you add my software to AlternativeTo? You can add it yourself :) Just
  sign up for an account, it's super simple. When you're registered, you
  just have to click the 'Suggest new application'..."

Note: the 2026-08-08 research-desk record quoted a "new users must wait a
week after the creation of their account" sentence. That sentence is not on
the live FAQ as of 2026-08-09 — the current FAQ requires verified email
before submitting instead. This packet records the current live state;
treat the week-wait as stale unless it reappears at submission time.

## Machine gate receipts (this run, 2026-08-09)

```
$ venue-claim check alternativeto.net 0509
policy disposition for alternativeto.net: reviewed (unknown)
exit=0   (no active record exists; venue policy disposition is authoritative)

$ venue-claim claim alternativeto.net 0509 --account hello+alternativeto@0509.io \
    --policy-date 2026-08-09 --policy-url https://alternativeto.net/faq/ \
    --copy-file docs/growth/alternativeto-submission-copy.txt \
    --evidence-path docs/growth/alternativeto-listing-2026-08-09.md \
    --removal-route "request removal/correction from the AlternativeTo page
    via the submitting account; AlternativeTo has no public removal API" \
    --verification-state pending
ERROR: ALLOWLIST/POLICY BLOCK: venue alternativeto.net is reviewed as
unknown - not automation-allowed; route to NEEDS-NISH/manual, never bypass.
exit=4   (no ledger record written; venues.json contains no
         alternativeto.net|0509 key)
```

## What an authorized submitter must do (the only path)

1. **Manual submission (the truthful primary path).** AlternativeTo's own
   flow is human-only: sign up at `https://alternativeto.net/signup` with
   the account email (use a plus-address on a monitored mailbox, e.g.
   `hello+alternativeto@0509.io`), verify the email, then click the User
   icon (top right) → "Suggest new application" and fill the form with the
   approved copy in `docs/growth/alternativeto-submission-copy.txt`
   (name, website URL, platforms, license, description, tags). Click
   "Submit the application" and retain the submission page / review status
   as the receipt. Optional: the $5 priority review is a NEEDS-NISH
   payment decision, not required for the free review-backlog path.
2. **No unattended signup or submission.** Venue policy requires verified
   human accounts; the venue-claim contract blocks agent browser work on
   non-allowlisted venues (`alternativeto.net` is `reviewed (unknown)` in
   `agent-state/growth-loop/venue-policy.json`). The account-owner step is
   not automatable and must not be automated.

## Exact approved copy (canonical; matches llms.txt and the live site)

See `docs/growth/alternativeto-submission-copy.txt` (exact text for the
venue). Key content, in one place:

- Name: **Five to Nine**
- Website URL: `https://0509.io`
- One-line description: "Watches competitors' Meta ads and landing pages,
  then sends screenshot evidence and change alerts before your next
  meeting." (live homepage meta description)
- Full description (claims all trace to the live homepage, `/llms.txt`, and
  the public `/search` preview): proof-backed competitor Meta-ad and
  landing-page change monitoring; public-source only (public Meta Ad
  Library plus the public landing pages ads link to — never logs in to
  anything); scheduled checks every 3–6 hours on paid plans (Scout every 6
  hours, Starter every 3 hours, Agency every 3 hours for its first 25
  watchlists with the rest every 6 hours) and a weekly check + weekly email
  brief on the free plan; source-linked evidence saved for each confirmed
  change; instant alerts on Starter and Agency.
- Platforms: Web (SaaS). Cost/License: Freemium, Proprietary.
- Tags (existing AlternativeTo vocabulary, verified live): Competitor
  analysis, competitive-intelligence, Social media monitoring.
- No claims beyond the above: no unverified review, traffic, ranking, or
  superiority claims; no unsupported spend/reach/impression benchmarks; no
  hardcoded prices.

## Acceptance and rollback

- Verify (after manual submission): `https://alternativeto.net/software/...`
  (the venue-assigned slug) returns a real Five to Nine page whose claims
  match this copy and link to `https://0509.io`; record the live listing
  URL. Under the recorded `unknown` disposition no claim record can exist
  (`claim` exits 4), so the live-page check plus this packet is the durable
  receipt.
- Rollback: request correction/removal from AlternativeTo via the
  submitting account if any listing claim drifts; do not create duplicate
  profiles. No product code changes are needed for the listing itself.
- The research-desk 2026-08-09 `next` note asks future 0509 cycles to
  re-check whether this listing gained a receipt before creating any
  follow-up; once the account owner submits, update this packet with the
  venue URL and status.
