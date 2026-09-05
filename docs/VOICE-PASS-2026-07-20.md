# Voice pass — 2026-07-20

Full-product copywriting pass on branch `polish/voice-pass`. Scope: in-app
states, buttons/CTAs, email subjects and openers, auth + onboarding, and
tooltip/aria consistency. Roughly 90 customer-facing strings changed across
20 app files (plus 1:1 test-assertion updates in 17 test files — no coverage
deleted). The landing page (`marketing.tsx`) was left untouched: its editorial
art direction is deliberate and nothing there read as clunky.

## The voice

Five to Nine speaks like a sharp colleague who did the work — confident,
specific, plain words, lightly warm, zero hedging, zero jargon-as-authority.
Canonical definition (rules 1–11) lives in `DESIGN.md` → "Voice". Short form:

1. Verbs over nouns — "We checked 24 ads", not "24 ads were checked".
2. Name the thing — "screenshot", not "evidence artifact". Exception: the
   proof vocabulary that maps to billing (*evidence checks*, *proof*) stays.
3. No exclamation marks in the app.
4. Sentence case for body, buttons, labels, headings.
5. Empty states always say what happens next.
6. Errors say: what happened → what we're doing → what you can do.
7. Never blame the user.
8. Buttons start with a verb; never "Submit".
9. No system-speak ("monitoring worker", "queued for dispatch") on customer
   surfaces.
10. Specific beats generic — subjects lead with the competitor or the number.
11. Honesty is untouchable: voice changes tone, never facts.

## Strings changed by surface (approx.)

| Surface | Strings |
| --- | --- |
| Watchlists (states, run labels, banners, errors) | ~30 |
| Search (creative/landing-page detail, action errors) | ~8 |
| Digests → Briefs page (labels, empty states, delivery health) | ~12 |
| Dashboard (partial-load, follow-ups, usage alerts, scan toasts) | ~10 |
| Collections (errors, buttons, limits) | ~6 |
| Shares / Clients (resource label "Digest" → "Brief") | 2 |
| Plan-limit copy ("You have reached" → "You've reached", app-wide incl. API/MCP error messages) | ~15 sites |
| Emails (instant subjects, scan-trouble, refund, account) | ~12 |
| Auth (login/signup error codes) | ~13 |
| Onboarding + unsubscribe + account | ~9 |

## Before → after (the worst offenders)

1. `search.tsx` creative text: **"Not detected from the ad snapshot yet."**
   → "We couldn't read text off this creative."
2. `app.watchlists.tsx` pending run: **"Queued — waiting for a monitoring
   worker"** → "In line — starts automatically"
3. `app.watchlists.tsx` empty events: **"Your activation scan is queued and
   waiting for a monitoring worker."** → "Your activation scan is in line and
   starts automatically."
4. `app.watchlists.tsx` delayed run: **"Your activation scan is delayed and
   queued for recovery. Review tracking access if it does not resume."** →
   "Your activation scan hit a delay, so we're retrying it automatically. If
   it doesn't start soon, check Source access."
5. `app.watchlists.tsx` skipped run: **"Stopped before evidence was created"**
   → "Stopped before results were saved" (and the long form: "Your first scan
   stopped before it could save results. Recent checks shows what happened
   and what runs next.")
6. Instant alert subject (`delivery.server.ts`): **"Landing page URL changed:
   Nykaa"** → "Nykaa changed a landing page URL" (likewise "Ad went inactive:
   X" → "X stopped running an ad"; "X: 3 changes detected" → "X made 3
   changes"; "Possible change detected: X" → "Possible change at X")
7. Digest all-quiet detail (`app.digests.tsx`): **"This digest was generated
   after monitoring completed without action-worthy competitor movement."** →
   "We ran every check for this period and found nothing worth acting on."
8. Auth (`auth.login.tsx`): **"That sign-in link could not be verified.
   Request a fresh link and try again."** → "We couldn't verify that sign-in
   link — it may have expired. Request a fresh one below."
9. Auth (`auth.login.tsx`): **"Sign-in is not configured yet. Ask support to
   finish account access setup."** → "Sign-in isn't set up yet. Email support
   and we'll sort it out."
10. Refund email (`delivery-billing-lifecycle-content.server.ts`): **"Your
    Five to Nine refund has been processed"** → "We've processed your Five to
    Nine refund" (footnote now: "email support … and we'll look into it")
11. Dashboard partial load: **"Some overview sections could not be loaded /
    The available sections are current. Refresh to retry the missing
    sections."** → "We couldn't load part of this overview / Everything shown
    here is current. Refresh to load the rest."
12. Watchlist failure (`resolveWatchlistRunCustomerError`): **"This scan
    failed. Check Source access, then retry or contact support."** → "This
    scan failed. Check Source access, then retry — or email support and
    we'll dig in."
13. Manual refresh toast: **"Nykaa watch refreshed successfully."** → "Fresh
    check complete — Nykaa watch is up to date."
14. Test email failure: **"The test email failed to send. Check your delivery
    settings or email support@0509.io."** → "We couldn't send the test email.
    Check your delivery settings, or email support@0509.io and we'll dig in."
15. Empty runs list: **"No checks recorded yet."** → "No checks yet — the
    first one shows up here automatically."
16. Candidate history: **"No candidate history yet."** → "No candidates yet —
    possible changes appear here before we confirm them."
17. Delivery attempt row: **"No watchlist send recorded yet."** → "No alert
    sent for this change yet."
18. Digest sidebar: **"Waiting for delivery activity"** → "No sends recorded
    yet"; **"Older delivery record found. Recipient delivery is unknown."** →
    "This brief predates per-recipient tracking, so we can't confirm who
    received it."
19. Onboarding pending button: **"Creating and queuing first scan…"** →
    "Creating and starting first scan…" (and lead: "We will validate the
    website…" → "We'll check the website… and kick off the first scan")
20. Onboarding row error: **"Your plan limit was reached before this row
    could be created."** → "You hit your plan limit before we could create
    this row."
21. Scan-trouble email body: **"We could not complete checks … you do not
    need to do anything."** → "We couldn't complete checks … you don't need
    to do anything."
22. Shared recovery line (`discovery-customer-copy.ts`): **"Review tracking
    access and retry when ready."** → "Check source access, then retry once
    it's ready." (button "Review tracking access" → "Check source access")
23. Collections error: **"That evidence link could not be saved. Check the
    URL and date."** → "We couldn't save that evidence link. Check the URL
    and date, then try again."
24. Collections validation: **"Collection name is required."** → "Give the
    collection a name first."
25. Everywhere: **"You have reached your … limit."** → "You've reached your …
    limit." (routes, API errors, MCP errors, presence)
26. Buttons: **"JSON export"** → "Export JSON" (watchlists, collections,
    briefs); digest filter **"Apply"** → "Apply filters"; collections
    **"Update item"** → "Save note and tags"
27. Run-status pill: **"Queued"** → "In line"; **"Queued for retry"** →
    "Retrying automatically"
28. List-card labels: **"Scan delayed — open to review recovery"** → "Check
    delayed — we're retrying"; **"Latest check failed — open to recover"** →
    "Latest check failed — open for next steps"; **"Latest check did not run —
    open to review"** → "Latest check didn't run — open for details"
29. Dashboard toast: **"Now tracking X. The activation scan is delayed, and
    recovery is queued."** → "Now tracking X. The activation scan hit a
    delay, so we're retrying it automatically — open Competitors to follow
    along."
30. Evidence usage heading: **"Evidence check limit reached." / "Evidence
    check usage is above 80%."** → "You've used all your evidence checks" /
    "You've used over 80% of your evidence checks"
31. Account: **"That passkey could not be added. Try again or use email
    sign-in."** → "We couldn't add that passkey. Try again, or use email
    sign-in."
32. First-scan banner delayed: **"The first scan is queued for recovery, and
    the next scheduled scan remains available."** → "The first scan hit a
    delay, so we're retrying it automatically. Your next scheduled scan is
    unaffected."

## Deliberately NOT changed (verified-claim surfaces — for Codex re-proof)

These strings carry carefully scoped factual claims. The voice pass left
their meaning and, in most cases, their exact wording alone. If any of them
is edited later, the claim needs re-proving, not just re-reading:

- `app/lib/discovery-customer-copy.ts` — the whole safe-summary matrix
  ("Live ad checks are temporarily delayed…", "…so searches show labeled
  sample data", cache/rate-limit/retry phrasing). Only the `recovery` line
  changed (item 22); every summary that states source health is verbatim.
  Note: `customerDiscoverySummary`'s allowlist regex depends on these exact
  strings — do not rephrase one side without the other.
- `app/routes/search.tsx` — "We couldn't confirm any ads whose advertiser or
  landing page is connected to this website."; freshness labels ("Fresh check
  delayed", "Recent cached result", "Older cached result", "Freshness
  unavailable"); "Source: Meta Ad Library visual check / API / sample data";
  demo-mode labeling.
- `app/routes/app.watchlists.tsx` — `resolveWatchlistTrackingPresentation`
  saved-evidence block ("Monitoring history is saved; new checks need source
  access…"); the FirstScanBanner release-proof line ("Provider access is
  disabled in this local release proof. No external check was attempted.");
  all cadence claims ("free checks weekly; paid plans check every 3–6
  hours").
- `app/routes/app.reports.tsx` — the evidence-review gate copy ("Review the
  current evidence before sharing or downloading this report.", "The report
  changed after you opened it…", "That publication is no longer active…").
  These are the approval-integrity contract, not tone.
- `app/lib/digest-email.server.ts` — the source-coverage footer ("verified
  evidence means a stored screenshot, page record, or source link is
  attached…") and the quiet-digest claim ("Completed checks found no
  action-worthy movement across the sources that ran."); digest subject
  number claims ("N changes found, M worth action").
- `app/lib/delivery-billing-lifecycle-content.server.ts` — every plan/limit
  statement (grace-state "your plan stays active while the payment processor
  retries", pause-newest-stays semantics, credit expiry on refund). Only the
  refund passive voice changed; the claims did not.
- `app/lib/monthly-recap.server.ts` — counts and the UTC/rolling-window
  disclaimer.
- Free-plan copy contract: free-plan failure states never say "retry"
  (manual refresh is paid) and always point at support — preserved and still
  test-enforced in `tests/watchlists.route.test.ts`.
- Legal/trust/status pages, `/compare/*`, and `marketing.tsx` — untouched.

## Verification

`node ./node_modules/vitest/vitest.mjs run` — 329 files, 3,487 tests, green
before and after every commit in this stack. Copy assertions were updated
honestly alongside each change; none deleted.
