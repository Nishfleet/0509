# AI Answer Readiness: rendered pages lack extractable detail — dogfood 69e1b4be47bf

**Status: root-cause resolution verified against the in-flight fix (PR #563);
item closes on merge + deploy + same-engine dogfood rerun. No duplicate PR opened.**

Branch: `fix/ai-answer-readiness-content-depth`
Base: `origin/main` at `6f1026f3`
Pull request: https://github.com/Nishfleet/0509/pull/566

## Item

- [dogfood `69e1b4be47bf`] AI Answer Readiness: rendered pages lack extractable
  detail (`ai-answer-readiness-content-depth`, warning) from
  `runs/20260808T074205Z-msk2fl3n.json`; page scope `/search`.
- Ledger-observed: "2 rendered pages have fewer than 250 words, led by /search
  with 207 words."

## Verdict

The finding is **live today** and its root cause is the same thin rendered
content that dogfood `694ddbd68e95` covers on the same two pages (`/search` and
`/auth/login`). The `ai-answer-readiness-content-depth` check is fed by the
same `rendered.wordCount` field as the thin-content finding, and its fix is
identical in substance: visible, page-specific content lifting both pages over
the engine's 250-word floor.

That fix is already in flight as PR #563 (`fix/search-thin-content`, CI green,
mergeable, merge state CLEAN) with regression tests. The 0509 improvement-loop
backlog note for the sibling item explicitly directs lanes **not to open a
second thin-content PR**, so this lane made no duplicate code change. Instead it
verified, with the exact engine the dogfood job wraps, that the in-flight fix
clears *this* finding, and records the evidence here.

## Verification (same engine the dogfood job wraps)

Engine: `proof-seo/server/audit/engine.js` (checkout
`/home/nish/workspaces/products/proof-seo`, the registry's SEO Fix Kit path),
`auditUrl(url, { maxPages: 6, pageSpeed: false })` — identical options to the
dogfood pipeline.

- **Live production, 2026-08-09 ~14:18Z (before fix):** finding present —
  `ai-answer-readiness-content-depth` / "AI Answer Readiness: rendered pages
  lack extractable detail", evidence "2 rendered pages have fewer than 250
  words, led by /search with 207 words."; `contentDepth.status =
  needs_repair`; lowContentPages = `/search` (207 rendered words) and
  `/auth/login` (193 rendered words); readinessScore 72, repairOpportunityCount 1.
- **Fixed code (PR #563 content, `fix/search-thin-content`), local dev server,
  2026-08-09 ~14:28Z:** `/search` renders **398 words**; `contentDepth.status =
  passed`, `lowContentPages = []`, `pagesWithEnoughText = 5`; **zero**
  AI-Answer-Readiness findings on the page.
- **`/auth/login`** cannot be crawled locally (auth-route rate limiter is
  fail-closed: live local probe returns 503 `rate_limit_unavailable`, same as
  the 694ddbd68e95 lane recorded), so it is verified deterministically: live
  baseline 193 rendered words + 87 unconditional visible tokens added by the
  login story-column proof row and one-time-link note (counted from the
  `auth.login.tsx` diff) → **~280 rendered words ≥ 250**.

Both pages therefore satisfy the finding's acceptance ("the page has at least
250 rendered words with visible, page-specific detail") once PR #563's content
is deployed. The dogfood job auto-resolves the fingerprint on the next complete
0509 audit after the deploy; no product code change is warranted from this lane.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

---
