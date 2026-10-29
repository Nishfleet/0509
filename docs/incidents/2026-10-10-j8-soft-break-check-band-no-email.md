# No "site looks broken" email after the 2026-10-10 21:00Z site sweep

Pairs with `2026-10-11-late-breakage-never-alerted.md`, which is a
different gap and did not cause this miss.

## What customers saw

Nothing. The J8 soft canary is the fleet's robot that visits its own
fixture site on a schedule and plays the part of a customer whose page
broke; on 2026-10-10 it was the only site with a soft break. No customer
site broke that night.

A soft break is a page that loads (HTTP 200) but has lost a section. The
fixture dropped its pricing list. The canary expected the email
`0509.in looks broken: breakage` inside the sweep hour plus 45 minutes of
grace. The sweep judged the change at 21:11:16Z, opened the incident and
the in-app alert at 21:11:17Z, and sent no email. The canary gave up at
21:45Z. The incident closed itself at 22:00:20Z, and the only
`incident_notice` row written that day was the resolution notice at
22:00:28Z, after the canary had already failed.

So a real soft break was seen, judged and filed in-app, and the one
channel the contract reserves for it never carried it.

## Start and end (UTC)

- 2026-09-30T02:28:20Z — `359fec6e5` (0509#5838) shipped the D3s own-site
  judgment and, with it, the gate that sends the open email only in the
  alert band (`filing.band === "alert"`). The gap is as old as the
  judgment itself.
- 2026-10-07T07:22:29Z — `fd65653ce` (0509#7191) moved the site sweep from
  06:05Z to 21:00Z, which is where the J8 spec waits and therefore where
  this gap first became visible.
- 2026-10-10T19:41Z — the canary signed in, reset the fixture to `base`,
  waited 90 minutes, then set it to `soft`.
- 2026-10-10T21:00:02Z–21:12:15Z — the sweep ran, 74 pages planned, 8
  fetch failures, none of them the fixture page, which returned 200.
- 2026-10-10T21:11:16Z — the `own_site_breakage` verdict: p=0.173.
- 2026-10-10T21:11:17Z — `signal` (aspect `breakage`), `incident`
  (`ed64b291…`, kind `breakage`), and an in-app `alert` of severity
  `normal`, "0509.in looks broken: breakage". No `SEND_EMAIL.send`.
- 2026-10-10T21:45Z — the canary gave up waiting for the email.
- 2026-10-10T22:00:20Z / 22:00:28Z — incident closed, resolution notice
  written.
- 2026-10-11T05:07:33Z — #7338 merged: a breakage judged after the sweep
  opens the incident and sends the email.
- 2026-10-11T07:01:26Z — #7342 merged: no fixed email for a break that
  was never emailed about.
- 2026-10-11T18:30:22Z — #7345 merged: the soft fixture empties the page
  so the nightly verdict stays in the alert band.
- 2026-10-11 — the coordinator settled the band rule on #7340: the alert
  band (p >= 0.5) emails, the check band stays in-app only.

## Root cause

The verdict landed in the check band, and the check band never emails.

`openBreakageIncident` returns before the enqueue unless
`filing.band === "alert"`. p=0.173 sits in the band 0.1 < p < 0.5, which
`docs/REBUILD-JEV.md` D3s calls "alert marked 'check this'": an incident
and an in-app alert, no email.

The evidence the judge saw was a real soft break — the evidence builder
reported `pricesVanished` and `textHalved`, and the R2 snapshots from
21:11:08Z hold exactly that state — but the fixture page extracted only
58 characters, and a mostly-empty page gave the judge little to read. The
same question, on the same evidence, is not stable across nights: it had
answered 0.58 on an earlier night, when the email did go out (#7339).

So the canary's determinism rested on the fixture, not on the judge. A
soft break whose announced-ness depends on where a noisy probability
lands is not a decision anyone made; it is the threshold sitting in the
middle of the judge's spread. The threshold itself is a decision (#7340)
and stayed where it was; what moved was the evidence.

## How it was detected

The scheduled production e2e suite, run `38080781394`. The J8 soft canary
waits to the sweep hour plus 45 minutes of grace for the
`0509.in looks broken: breakage` email. Nothing arrived, so it failed
against the reporter's inbox. The canary had been green on the earlier
runs, which is what made the miss worth a production read rather than a
retry.

## The fix

- **Product, late breakage** (#7338, merged 2026-10-11T05:07:33Z). When a
  breakage judgment is deferred or fails during a sweep,
  `publishSiteChange` filed a plain signal and `rejudgeUnjudgedChanges`
  later linked the verdict without opening the incident or sending the
  email. `rejudgeStoredChange` now calls `openLateBreakage`, which opens
  the incident, files the alert and, for the alert band, queues the email.
  Three limits live there: `LATE_BREAKAGE_MAX_AGE_MS` (48 hours) is not
  announced, an incident already open suppresses a second, and a
  check-band break stays in-app only.
- **Product, fixed email** (#7342, merged 2026-10-11T07:01:26Z). The fixed
  email went out for every closed incident whose id was not in
  `delivery`, including breaks that were never announced. It now requires
  a recorded open notice (`incidentWasAnnounced`), and a missing notice
  produces the `unannounced` outcome.
- **Fixture** (#7345, merged 2026-10-11T18:30:22Z). The soft mode now also
  drops the `<h1>` and every paragraph, so the page extracts to 27
  characters instead of 58 and the evidence is `{httpError: false,
textHalved: true, pricesVanished:
true}`. #7345 measured the shipped D3s question at 0.750 / 0.740 / 0.760
  on three repeats against it, all in the alert band, with the healthy
  control at 0.08 / 0.09 / 0.08. Those numbers are #7345's own, measured
  on the fixture it had just retuned, so they are not an independent
  check on the fixture's band; they are the reason the band moved. The
  margin is thin on the other side too: the healthy control sits 0.01 to
  0.02 under the 0.1 clear line, so one healthy night can open an
  incident. Three repeats per mode are the floor for a judgement near a
  threshold; one repeat cannot distinguish a decision from a draw.
- **Spec** (#7317, merged 2026-10-10T14:16:47Z). The J8 spec now reads its
  deadline from `SITE_SWEEP_UTC_HOUR` (added by `418b7416d`) instead of a
  hard-coded 21, and `sweepDeadlineMs` is `max`(the 90-minute wait, the
  next sweep plus 45 minutes of grace), so the wait is never shortened.

No wait was shortened and no assertion was loosened. The canary still
waits the full grace period and still requires the open email, the fixed
email and no alerts after recovery.

## What stops a repeat

Ranked by the correction ladder in `AGENTS.md`: code and lint first, docs
last.

1. **Code.** `tests/integration/site/sweep.integration.test.ts` pins all
   three bands against a real D3s stub: p=0.8 opens the incident, a
   pinned high alert and exactly one queued email; p=0.3 opens the
   incident and a normal alert and asserts `send` was never called; p=0.05
   opens no incident. The retried publish re-enqueues once. A change that
   widens the email to the check band turns this file red.
2. **Code.** `tests/integration/site/late-breakage.integration.test.ts`
   (five cases) covers the lane #7338 added; two of them fail on `main`
   without that change.
3. **Code.** `tests/integration/incident-lane.integration.test.ts` pins
   `unannounced`: a fixed email never goes out for a break that was never
   emailed.
4. **Code.** `tests/fixtures/fixture-page-texts.ts` pins the soft page's
   extracted text through production's own `extractPageText` and
   `computeBreakageEvidence`, so editing the fixture text in a way that
   moves its band fails the merge gate instead of the next canary.
5. **Docs.** A new bullet under "Rules per decision" in
   `docs/REBUILD-JEV.md` names all three D3s bands and says which one
   emails, and the stale `p >= 0.9` line above it now reads the shipped
   `p >= 0.5`. Before this, the D3s row said "immediate alert" and "alert
   marked 'check this'" without saying which of the two bands carries an
   email, and two trusted directives read that row two different ways on
   the same line of code (#7339, #7340), which cost a worker run and a
   closed PR.

**Honest limit.** A soft break on a real customer's site that lands in the
check band is still in-app only and never emailed: that is the decision
the coordinator made on 2026-10-11, not a gap left open by this
postmortem. The in-app alert for the 2026-10-10 break was correct and
present; only the email was missing.

The canary itself has not yet been proven green on the retuned fixture.
That proof is the next scheduled production run after this postmortem,
and until it runs, item 4 above is a gate on the fixture text and not yet
an observation of a stable nightly verdict.
