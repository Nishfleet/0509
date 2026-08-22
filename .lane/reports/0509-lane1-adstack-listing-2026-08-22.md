# Lane 1 report — ad-stack.ai "best ad intelligence software in 2026" listing

**Item:** Get Five to Nine listed on ad-stack.ai's "best ad intelligence software in 2026" ranking — the current-month on-call listing item.

**Status:** HEADLESS_BLOCKED / PREPARED_CURRENT — the venue's only submission path is an email to `hello@ad-stack.ai` from a real, human-owned mailbox. This lane has no authorized outbound email channel or credentials. The prepared pitch in `docs/adstack-listing-2026-08-11.md` is current as of 2026-08-22.

**Branch:** `0509-lane1-adstack-listing-2026-08-22`
**Base:** `origin/main` at `2a001535e8e1c97d09cae9bff351ab9887d099f4`

## What the venue is (verified 2026-08-22)

- Ranking essay: `https://ad-stack.ai/blog/best-ad-intelligence-software-2026/`, "The best ad intelligence software in 2026, ranked", published 2026-07-15. HTTP 307 (redirect to `www.ad-stack.ai`, final 200).
- Eight tools listed (in order): Superscale, Foreplay, Meta Ad Library, Atria, Sensor Tower (Pathmatics), AdSpy, BigSpy, SpyFu.
- About page: `https://ad-stack.ai/about`, HTTP 307 (redirect to `www.ad-stack.ai`, final 200). It still carries the "Got a tool we should look at?" section with `mailto:hello@ad-stack.ai` and the no-pay-to-play language.
- FAQ Q-03 (on the ranking page): re-tests are "Every quarter. ... the score on the main review only moves at the next full re-test."
- Five to Nine / 0509 is not mentioned on the ranking page (grep for `five to nine`, `0509`, `five-to-nine` returns 0).

## Prepared pitch (canonical source)

Use the existing, venue-grounded submission in `docs/adstack-listing-2026-08-11.md`. Do not re-draft. The key fields are:

To: `hello@ad-stack.ai`
From: `support@0509.io`
Subject: `Tool for your ad-intelligence ranking: Five to Nine (competitor ad monitoring, with evidence)`

Body:
> Hi ad-stack team,
>
> Tool for your ad intelligence coverage: **Five to Nine**
> (https://0509.io) — competitor ad and landing-page monitoring where every
> change alert carries screenshot evidence and a source link you can open
> yourself.
>
> Five to Nine watches competitors' Meta ads and public landing pages,
> compares each check against a baseline, and sends one alert per confirmed
> change — plus a quiet heartbeat when nothing moved, so silence always
> means we looked. Paste a competitor site at https://0509.io/search to
> preview the ads they're running right now, no account needed. Paid plans
> check every 3–6 hours; the free plan covers one competitor with a weekly
> email brief.
>
> Where it fits your ranking: the monitoring shelf next to Foreplay and the
> Meta Ad Library, with proof attached (that's our whole bet — the library
> gives you raw ads, we give you what changed and when). We're honest about
> the edges: Meta ads are the automated channel today, landing pages are
> public-web, and we don't do spend estimates.
>
> Happy to give you a seat (free plan or paid, your pick — you pay for your
> own seats anyway, per your FAQ) if you'd like to run it through your
> twelve-metric protocol for the next quarterly re-test.
>
> Best,
> Five to Nine

(verbatim from `docs/adstack-listing-2026-08-11.md`, lines 100–131)

## Freshness pass (this lane, 2026-08-22)

Live checks from this worktree:

| URL | HTTP | Notes |
|---|---|---|
| `https://ad-stack.ai/blog/best-ad-intelligence-software-2026/` | 307 | ranking page still lists 8 tools, no 0509 (count: 0) |
| `https://ad-stack.ai/about` | 307 | still has `mailto:hello@ad-stack.ai` and no-pay-to-play language |
| `https://0509.io/` | 200 | homepage title "Five to Nine \| Know when competitors change the offer" |
| `https://0509.io/search` | 200 | public search preview, no account needed |
| `https://0509.io/auth/signup` | 200 | email magic-link signup |
| `https://0509.io/compare/magicbrief` | 200 | migration guide still 200 |

Plan-fact cross-check against `app/lib/plan-entitlements.ts`:

- `free`: `watchlists: 1`, `collections: 1`, `includedEvidenceChecksPerMonth: 1`, `digestCadence: weekly`, `scheduledScanCadence: weekly` → "the free plan covers one competitor with a weekly email brief" is still accurate.
- `scout`: `watchlists: 3`, `includedEvidenceChecksPerMonth: 50`, `scheduledScanCadence: every_6h`, `digestCadence: weekly` → part of "paid plans check every 3–6 hours".
- `starter`: `watchlists: 10`, `includedEvidenceChecksPerMonth: 250`, `scheduledScanCadence: every_3h`, `digestCadence: daily_and_weekly` → part of "paid plans check every 3–6 hours".
- `agency`: `watchlists: 75`, `includedEvidenceChecksPerMonth: 2500`, `scheduledScanCadence: every_3h` (first 25 slots at 3h, the rest at 6h), `digestCadence: daily_and_weekly` → part of "paid plans check every 3–6 hours".

No drift from `docs/adstack-listing-2026-08-11.md` (last re-verified 2026-08-21, commit `21c31844`) was observed on 2026-08-22.

## Why this is a headless-blocked item

1. The venue has **no form, no account, and no payment** — the entire submission is one email.
2. The email must come from a real, human-owned `support@0509.io` mailbox, not from this unattended lane.
3. The repo's only outbound sender is the production Worker's Cloudflare `send_email` binding (used for product digests/alerts; see `docs/adstack-listing-2026-08-11.md`, lines 73–76). It requires production secrets/deploy and is not appropriate for a one-off vendor pitch.
4. This lane has no ad-stack.ai account, no mail client, no SMTP credentials, and no Nish-authorized send path.
5. **Do not** use `curl`/scripts to send email, and **do not** use the production `send_email` binding.

## Exact next step (owner)

Send the prepared email from `support@0509.io` to `hello@ad-stack.ai` with the subject and body above. Record the send date and any reply. The realistic listing target is the next quarterly re-test of the essay (per FAQ Q-03, ~October 2026). There is no coverage guarantee.

## Files

- `.lane/reports/0509-lane1-adstack-listing-2026-08-22.md` — this evidence record.
- `docs/adstack-listing-2026-08-11.md` — canonical paste-ready pitch (read-only in this lane; not modified).

## Proof

- `curl -sS -o /dev/null -w '%{http_code}' https://ad-stack.ai/blog/best-ad-intelligence-software-2026/` → 307
- `curl -sS https://ad-stack.ai/blog/best-ad-intelligence-software-2026/ > /tmp/adstack-ranking.html` and case-insensitive count of `five to nine` / `0509` / `five-to-nine` → 0
- `curl -sS -o /dev/null -w '%{http_code}' https://ad-stack.ai/about` → 307
- `curl -sS -o /dev/null -w '%{http_code}' https://0509.io/` → 200
- `curl -sS -o /dev/null -w '%{http_code}' https://0509.io/search` → 200
- `curl -sS -o /dev/null -w '%{http_code}' https://0509.io/auth/signup` → 200
- `curl -sS -o /dev/null -w '%{http_code}' https://0509.io/compare/magicbrief` → 200
- `fleet-resolve-item status --workspace /home/nish/workspaces/agent-worktrees/0509-lane1-20260822-182532` shows `e230977cba` as `retired`.
- `git diff origin/main..HEAD --name-only` returns exactly `.lane/reports/0509-lane1-adstack-listing-2026-08-22.md`.

## Rollback

N/A — this is an evidence-only lane record. No product code, data, billing, or production state was changed.
