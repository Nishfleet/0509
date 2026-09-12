fix(email): outbound-auth regression gate for 0509.io DNS

Closes #2966

## net-positive-because:

net-positive-because: the change is deliberately additive — a regression gate + tests + an evidence doc. The zone's DNS state cannot be re-derived from code (Cloudflare-side state), so the repo has no way to detect a half-finished DNS re-regression without this detector; the +341 lines are the gate (172), its branch-pinning tests (129), and the canonical evidence doc (40).

## What shipped

The zone 0509.io now carries the strict outbound-auth state; this PR ships the durable repo half — a detector/gate so the half-finished state cannot silently return (fleet-ops#366 mechanical-fix):

- `scripts/check-outbound-email-auth.mjs` — live `dig` gate that fails loud (exit 1) on: SPF softfail `~all`, DMARC without `p=`/`rua=mailto:`, or DKIM not published at the required selector (`cf2024-1` default, overridable via `CHECK_DKIM_SELECTORS`). Exit 2 = infrastructure error (dig missing/timeout).
- `tests/outbound-email-auth.test.ts` — 10 tests pinning the TXT parser against the real multi-chunk DKIM dig output (255-byte chunk join) and every failure branch.
- `docs/email-outbound-auth.md` — verified live state, evidence, and the selector finding.

## Selector finding

The real DKIM selector is `cf2024-1`. Authority: Cloudflare's own `GET /zones/{zone}/email/routing/dns` returns this record as part of the recommended DNS configuration for the verified 0509.io domain; `default`, `cf1`, `cf2`, `cf2024-01` are intentionally empty. Common-selector emptiness in the audit evidence was a probe-selection gap, not a missing record.

## Verification (real run, 2026-09-11, worktree /home/nish/workspaces/agent-worktrees/issue-0509-2966)

- `node scripts/check-outbound-email-auth.mjs --json` → ok: true, zero failures; live records: SPF `v=spf1 include:_spf.mx.cloudflare.net -all`, DMARC `v=DMARC1; p=reject; rua=mailto:dmarc@0509.io`, DKIM found at `cf2024-1`.
- `PATH=.../node_modules/.bin:$PATH bash ./scripts/ci-vitest-run.sh -- vitest run --configLoader runner --project node --changed origin/main` → 10 passed / 1 file. (First wrapper invocation failed with exit 127 `vitest: command not found` — PATH issue only; re-run green on the repo wrapper.)
- Dynamic zone evidence: `zones/{zone}/email/routing/dns` returns `cf2024-1._domainkey.0509.io` DKIM TXT record; Email Routing enabled/synced; catch-all routing rule delivers `dmarc@0509.io` reports to the `0509-support-inbox` worker.

## In-scope split

Live-send deliverability proof (real Gmail + Outlook receipts showing Authentication-Results) is the delivery half tracked in `Nishfleet/0509#2983` per the scope-split comment from nish3451 on #2966 ("Do the DNS/DKIM here, the delivery proof there").

## run-proof:

run-proof: scripts/check-outbound-email-auth.mjs live run 2026-09-11T22:24:17Z (ok: true, 0 failures); vitest node --changed run: 10 passed / 1 file (`tests/outbound-email-auth.test.ts`); no units/timers/workflows touched by this diff (repo-side detector only, no cron/workflow added).

## loose-ends

loose-ends: none-blocking — live Gmail/Outlook Authentication-Results receipt remains open in `Nishfleet/0509#2983` (explicit scope split on #2966).
