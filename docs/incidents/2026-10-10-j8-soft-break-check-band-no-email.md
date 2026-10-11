# 2026-10-10: a soft-broken own site opened an incident but no email left

## What customers saw

Nothing was sent. A real soft break — the pricing section vanished from a 200 page — opened an incident at 21:11Z, but the "looks broken" email the journey waits for never went out. The J8 soft journey timed out at 21:45Z (run 38080781394, failed 2026-10-10 21:45Z). Found by the J8 soft journey, e2e+j8-soft-v2@0509.io on workspace j8-soft-v2.

## Start and end (UTC)

Start: 2026-09-30 (commit 359fec6e5, #5838, narrowed the email to the alert band). End: when the fix PR for #7337 is deployed; the deploy time is added here once known. The same condition produced working sends on 2026-10-02 and 2026-10-08 and silence on 2026-10-10.

## Root cause

The sweep judged the breakage correctly and opened the incident, but queued the email only when the D3s verdict landed in the alert band. The verdict landed at p=0.173 — inside the check band (0.1 < p < 0.5) — so `openBreakageIncident` wrote the incident, the pinned alert (severity normal) and no send. Commit 359fec6e5 added `&& filing.band === "alert"` to the email gate; before it, every newly opened breakage incident emailed.

The J8 spec (#4124) defines the soft break as "a 200 page whose pricing section is gone" and waits for the `looks broken: breakage` email. The product's own design (docs/REBUILD-JEV.md, D3s) says the middle band is an alert marked "check this", with the reason "a false alarm costs ten seconds; silence on a broken site costs the customer". The email gate dropped the middle band on the floor.

Jev made the failure a coin flip. The same semantic change — the pricing section removed, the rest identical — was judged p=0.5841 on 2026-10-08 (alert band, email sent) and p=0.173 on 2026-10-10 (check band, silence). The 2026-10-09 verdict on the restored page (p=0.0576, clear) was correct. Jev's volatility on this question is real; a hard p >= 0.5 email gate therefore sent the canonical soft break about half the time.

The judge's inputs were sound: `computeBreakageEvidence` handed Jev `pricesVanished: true` and `textHalved: true` (73 visible chars after, 203 before), and the R2 snapshots hold exactly that state. The model, not the evidence, moved.

## How it was detected

The J8 soft journey, by the missing email. No product-side alert fired: the incident existed, the alert row existed, and nothing watches "incident with no send".

## The fix

`openBreakageIncident` now queues the one incident email whenever the incident is newly opened — both bands. The band distinction stays where it was designed to stay: the alert's severity on the Alerts page (high at p >= 0.5, normal and marked "check this" between 0.1 and 0.5). The email subject is the same either way, so the journey's poll is deterministic regardless of where in the two upper bands Jev lands. No D3s question text, threshold or prompt changed, so no eval re-run is required.

Tests: the check-band sweep test now expects one queued email with the normal-severity alert (`tests/integration/site/sweep.integration.test.ts`), and the dedupe test still proves a second run while the incident is open sends nothing.

## What stops a repeat

1. Code: the check-band test above pins the email for every newly opened breakage incident, and the clear band still sends nothing (0.05 test in the same file).
2. Code: the alert-band and dedupe tests still pin one email per incident.
3. Not done: Jev's volatility on the D3s question is logged here as a known property, not fixed. If a real break is ever judged clear (p <= 0.1), no email goes out — that would need the eval process (held-out cases, before/after numbers) on the question text, which is a separate decision.
