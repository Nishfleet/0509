# Findings + adjudication — issue #3301 phase 5 (accept-4)

Sweep: `.fleet/sweep-3301/run-sweep.mjs`, 10/10 journeys (5 surfaces × 2 viewports), unbounded
(no MAX_FINDINGS), pre-fix prod (`https://0509.io`), window 2026-09-12T23:45:50Z → 23:46:41Z.
Per-finding evidence: `logs/<journey>-<viewport>.md` + `screenshots/<journey>-<viewport>.png`.
Buckets are the house review-adjudication ones; every finding lands in exactly one.

## Findings

| # | Where | What | Class / verdict | Evidence | Bucket |
|---|---|---|---|---|---|
| 1 | populated `/search` + selected proof (b, c; desktop + mobile) | 5 console CSP errors + 5 enforce `securitypolicyviolation` + 2 pageerrors (**React #419**) per journey; 6/14 inline scripts nonceless: ld+json + react-dom continuations (`_R_` timing, `$RB`/`$RV` helper, 4× `$RC` boundary-completion) | the #3301 CSP-nonce class — the issue itself | `logs/b-*.md`, `logs/c-desktop.md`; issue evidence (walk hashes `sha256-7mu4…`, `sha256-QAlS…` = same two blocked executions, different response) | **Act on** — this PR (phase-2 fix covers every one: `options.nonce` on `renderToReadableStream` stamps ALL react-dom continuations; `jsonLdScriptProps` nonce stamps the ld+json) |
| 2 | empty `/search` (a; desktop + mobile) | 1/8 inline nonceless — the ld+json only; zero violations/errors | #3301 class, acceptance-1 includes the empty surface | `logs/a-*.md` (inventory §ld+json) | **Act on** — same fix (`app/routes/search.tsx` wires the nonce into the shared `jsonLdScriptProps` call) |
| 3 | `/pricing` (d; both) | 11/11 inline nonceless, yet CSP policy carries **no nonce token at all** → 0/0/0: zero console, zero violations, zero pageerrors | internally consistent: no nonce requirement, nothing to violate; #2971/#3083's `style-src 'unsafe-inline'` is a different directive (out of scope) | `logs/d-*.md`; `supplementary-headers.md` (pricing: "1st enforce nonce: none") | **Noted** — no wiring needed; nothing to fix, nothing ships |
| 4 | `/auth/signup` (f; both) | 1/8 inline nonceless (ld+json) with **0** violations collected and 0/0/0 console | suspected raw-fetch-inventory vs rendered-document response variance (the inventory is a separate second request; the journey document evidently satisfied its policy — 42-event collector proven working on c-mobile) | `logs/f-*.md`; digest | **Noted** — signup logs zero errors, which is all acceptance-2/4 requires there; follow-up candidate at most |
| 5 | selected proof (c; both) | 1 failed request: `/search.data?…&selected=…` — `net::ERR_ABORTED` (other), navigation still completes to `#selected-proof` | aborted, not errored; plausibly downstream of the broken hydration bridge | `logs/c-*.md` (failed requests §) | **Consider** — expected to disappear post-fix; the gate collects but does not fail on failed requests (acceptance-2/3 never required a failed-request assertion — nothing weakened) |
| 6 | c-mobile only (1 of 10 journeys) | 42 report-only `securitypolicyviolation` events + 40 info console records (policy `script-src 'unsafe-inline' 'unsafe-eval'`, `disposition: report`) | report-only → zero enforcement, zero user impact; correlates with Cloudflare cache state | `logs/c-mobile.md`; `supplementary-headers.md` (probe: enforce responses carry exactly 1 nonce, no report-only header) | **Consider** — answered by the header probe; no code change; same #2971/#3083 territory |

## The walk's 8 suppressed findings (accept-4)

The suppression discarded them before persistence: the walk's evidence dir
(`scout-money-path/20260912T135237Z/`) holds only the 8 PNGs, and every later overnight walk
(`20260913T0*Z`) persists PNGs only — the 8 are not enumerable anywhere.

**Dismissed-with-reason: unrecoverable-as-enumerated, superseded by this sweep.** This sweep
re-observed the same four walked surfaces (plus the selected-proof state) unbounded — every
console record, every CSP event, every pageerror, every failed request, saved as text + PNG.
Its complete record contains exactly two observational classes: the #3301 CSP-nonce class
(rows 1–2) and the report-only variance (rows 5–6). No third, different error class exists in
the unbounded record, so there is no suppressed finding of a different class to comment or
file — nothing silently absorbed, nothing truncated (rows 3–4 are zero-error surfaces).

Nothing in this table changes the plan: rows 1–2 are what the phase-2 fix + phase-3 green proof
close; rows 3–6 require no code in this PR.
