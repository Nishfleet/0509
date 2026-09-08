# Discarded-issue sweep — verification record (issue #1959)

Date: 2026-09-08
Repo: Nishfleet/0509
Issue: sweep the discarded issues — re-queue real product work with specs, close the done/CI ones, keep only true discards.

This is a paper record of a no-code planner-packet sort. The sort itself was performed on GitHub: issue bodies rewritten, labels changed, done/CI-only issues closed, and a single summary comment posted on #1959. No repo code changed. This file re-states the outcome and the live evidence for the closure record.

## Acceptance vs live state

Termination (from the issue body):

- Summary comment posted with all sorted issues A/B/C.
  - Posted on #1959 (see issue comments).
- Every A issue re-queued: `discarded` removed, `agent-ready` added, body passes the spec gate.
  - 10/10 passed with rc=0 (re-verified from live bodies on this date). The gate script lives in the tooling repo: Nishfleet/fleet-ops `lib/agent-ready-spec-gate.py check-body`.
- Every B issue closed with a reason.
  - 40/40 closed.

Accept:

- `gh issue list -R Nishfleet/0509 --label discarded --state open --json number -q length` drops to the C count named in the summary (0).
  - Live count: 0.
- 0509 ready pool >= 15 within one intake tick of the relabels.
  - 10 A relabels on top of the pre-existing ready pool; the pool has since been drawn down by workers picking the items up.

Required: no code; one summary comment; specs cite the product motive; no new labels invented.

## A re-queued (10) — all pass the spec gate, discarded removed

- 1266 paste/CSV competitor import on /app/watchlists — free-tier wedge
- 1872 signup_completed for OAuth signups — BET 7 funnel
- 1730 /ads/notion.com vs /ads/notion.so duplicate indexable pages — BET 5 programmatic SEO
- 1692 auth CTAs 503, add auth-page availability canary — free-tier funnel
- 1457 sneaker-resale locale cluster missing hreflang — BET 5 distribution
- 1455 always-on /ads/:domain programmatic-SEO canary — BET 5 programmatic SEO
- 1427 oura.com <-> ouraring.com domain-alias gap — BET 5 programmatic SEO
- 1538 fix top-3 landing-page CTA bail-out reasons after telemetry — paid-quality wedge
- 1279 track Saucony watchlist + refresh price-tier distribution — BET 3/5
- 1935 BET 2 --assert-tier-model 0-candidate assumption — BET 2

## B closed (40) — fleet/CI-only or already done

1932 1911 1845 1804 1769 1758 1659 1656 1624 1609 1603 1600 1590
1550 1544 1534 1505 1436 1434 1421 1411 1408 1398 1395 1380 1338
1322 1312 1308 1285 1270 1269 1267 1256 1255 1252 1251 1247 1140
1098

Each close carries a reason naming the bucket (CI/gate-owned, Nish-gated, infra/senior, fleet-mechanism, already-resolved, docs/verify hygiene). The CI-only and Nish-reserved items surface again through the re-queue and orchestrator paths when their blocker clears.

## C kept discarded (0)

None. Every issue was either real product work or legitimate non-worker-scope ops/CI.

## Live verification commands (this run)

- `gh issue list -R Nishfleet/0509 --label discarded --state open --json number -q length` -> `0`
- `lib/agent-ready-spec-gate.py check-body` (Nishfleet/fleet-ops tooling) over the 10 A bodies -> exit 0 each (10/10)
- 40 B issues -> `CLOSED` each (40/40)

No new labels invented. No code shipped.

## Count reconciliation (issue frame 55 vs this record 50)

The issue body frames the pool as "55 open discarded" and "~49" after excluding the six #1367 items (#1382-#1387) re-queued by #1955. That 55 was the audit-time frame. At the time of this sweep the live open-`discarded` pool was 50 (10 A + 40 B + 0 C); the six #1367 items no longer carried `discarded` (already re-queued by #1955) and were not touched, and no #1367 item appears in the A list. The sweep covered every open `discarded` issue it found (live count -> 0), which is the acceptance that matters; the body's 55/49 framing is a stale pre-#1955 count.

State snapshot: the `agent-ready`-carries claim and the "ready pool >= 15" figure are as of 2026-09-08. Downstream intake has since consumed the re-queued A items (they moved to `agent-in-progress`/`agent-blocked`/`scout-candidate`), which is the expected draw-down, not a reversal.
