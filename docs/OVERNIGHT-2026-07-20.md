# Overnight Run — 2026-07-19 22:00 → 2026-07-20 (IST)

## ⚡ FINAL STATE (morning of 2026-07-20)

- **PR #360 (the full overnight stack) is MERGED to main.** Its deploy is blocked ONLY by remote migration 0070 — run: `cd /tmp/0509-integration && npx wrangler d1 migrations apply 0509 --remote` (should list `0070_release_scheduled_observations.sql`), then tell Claude — the deploy re-run + everything after is automated via Chrome.
- **PR #361 (fast-follow) is OPEN and verified**: polish fixes (status-pill Title-Case bug, onboarding hero clip) + two real 500 fixes found by the QA crawl + `docs/QA-MATRIX-2026-07-20.md`. Merge right after #360's deploy goes green.
- **Final QA gate: GREEN.** 3,690 tests · 66/66 Gate-B journeys · button-crawl 4 tiers × light/dark × desktop/mobile: 0 hard failures, "zero jank in the authenticated app." Full matrix in docs/QA-MATRIX-2026-07-20.md.
- **For Codex:** (a) `e2e/local-authenticated.spec.ts` has 6 stale assertions vs shipped copy (Briefs rename, presence gating, report copy) — realign; (b) re-proof the reopened free-plan claims post-deploy; (c) close superseded PRs #344/#345.
- **Design session queued (needs Nish + Mobbin):** /ads/:domain hero — the one surface flagged "needs design, not polish."

Autonomous build night, authorized by Nish. Manager: Claude (this session). Builders: isolated subagents, one worktree/branch each. **Every branch below was independently reviewed by the manager after building — tests re-run, diffs inspected — before being accepted.** Nothing was merged or deployed; that's the morning sequence at the bottom.

## Branches built tonight (in landing order)

| # | Branch | What it delivers | Tests | Verdict |
|---|--------|-----------------|-------|---------|
| 1 | `spec/thumbnails-live-dom` | **The big fix.** Live investigation proved Meta's 2026 Ad Library DOM has no id anchors — card discovery found 0 cards; everything fell to text-only parsing. Rebuilt discovery (Library-ID label climbing, validated live: 24 cards vs 0), CSS-background + video-poster creative capture, avatar guards, `l.facebook.com` redirect decoding for landing links, variantCount on all paths, footer-chrome truncation. Thumbnails + depth + landing links in one branch. | 3,296 | ACCEPTED |
| 2 | `spec/minor-batch` | All 15 review MINORs: digest grouping across watchlists, heartbeat auto-degrade (3 quiet dailies → silent until movement), batched-alert advertiser gate, Briefs rename completion, restored marketing test assertions, dead-code deletion, WP-41 leftovers (onboard search-first button, shares empty action, ProofGlossary), plan-blip fail-open, derived rate-limit cleanup, pluralization, Bricolage 700, + the CLAUDE.md agent-operating-model section. **Note: touches 2 deploy-gate e2e specs (Briefs rename) — gate updates land with the product change, per policy.** | 3,298 | ACCEPTED |
| 3 | `feat/search-steal-summary` | "WHAT TO STEAL": 3-bullet AI takeaway on fresh signed-in searches. Strictly grounded (digit/brand-token validation against input; wholesale reject → null), injection-framed, demo-gated, cost-gated to fresh scrapes only. | 3,309 | ACCEPTED |
| 4 | `feat/funnel-seo` | Product FAQ (honesty-hardened answers), new `/compare/meta-ad-library` page, shared marketing footer + 05:09 brand line, Organization/WebSite/FAQPage JSON-LD (escaped), sitemap additions (`/search`, `/auth/signup`, compare), search page title SEO. | 3,303 | ACCEPTED |
| 5 | `feat/angle-classifier` | Marketing-angle classification (6 angles, margin-scored cues + patterns, ES/PT/FR/DE coverage, no-guess nulls, pressure-blocked lifestyle fallback). Angle chips on cards + detail rows. | 3,329 | ACCEPTED |
| 6 | `feat/competitor-dossier` | **The flagship.** "Intelligence" section on watchlist detail computed from accumulated scan history: proven runners with longevity, hook patterns, format mix, ad velocity chart, landing-page change history — all retention-bounded and provenance-labeled. The "workspace memory" promise, visible. | 3,315 | ACCEPTED |
| 7 | `feat/chrome-extension` | MV3 extension v1 (`extension/`, fully build-isolated): browse any brand site → one click → their ads via 0509. activeTab-only, zero tracking, brand-styled, live-verified popup, store-listing draft in its README. | +7 | ACCEPTED |
| 8 | `feat/public-brand-pages` | `/ads/:domain` programmatic public pages — cache-only (zero provider calls, test-enforced), honest freshness labels, indexable by default per Nish's authorization with guards (miss/demo/stale >7d always noindex; `PUBLIC_BRAND_PAGES_INDEXABLE="0"` = emergency brake), rate-limited, signup CTA carrying the domain. | 3,309 | ACCEPTED |
| 9 | `feat/dark-mode-ux` | Workspace dark mode (pre-paint boot script, System/Light/Dark toggle in account, marketing pinned light, contrast-verified ≥4.5:1, live-checked on /search), optimistic watchlist row actions via fetcher, skip-to-content + aria-current nav, demo Sample badges, mobile brief-strip. **Tomorrow's live pass must cover authenticated /app dark screens (unseen).** | 3,315 | ACCEPTED |
| 10 | `feat/free-weekly-watch` | PLG wedge (SHIPPING ENABLED per Nish): free = 1 competitor, scanned Mondays 03:00 UTC feeding the 05:00 weekly brief; 7-day shared-cache reuse test-proven (popular competitors = zero marginal cost); full honest copy sweep across 10+ surfaces; digest upgrade line derived from live entitlements (no hardcoded prices); MCP/AI-agents docs section. | 3,301 | ACCEPTED |
| 11 | `feat/counter-brief-score` | Capstone, chained on dossier+angles (lands after both): angle-mix wired into the dossier; Ad Aggression Score 0-100 (transparent public formula, four components summing exactly, honest 14-day evidence floor); AI Counter-Brief (gap naming a real zero-count angle, 3 grounded hook directions ≤120 chars with cited rationales, watch note; paid-gated, wholesale-reject validation, AI disclosure line). No migrations. | 3,393 | ACCEPTED |

## Morning landing sequence (Nish's terminal) — ONE PR

All eleven branches were merged overnight into **`overnight/integration-2026-07-20`** (conflicts resolved by the manager; full suite green on the COMBINED stack: **329 files / 3,487 tests**, typecheck clean, pushed). The individual branches remain on origin for archaeology, but you land one thing:

```bash
cd "/Users/nish/Vibecoded projects/0509" && git fetch origin
gh pr create --base main --head overnight/integration-2026-07-20 \
  --title "Overnight: money-moment DOM fix, Dossier+Score+Counter-Brief, dark mode, public brand pages, free weekly watch, extension" \
  --body-file docs/OVERNIGHT-2026-07-20.md
gh pr merge overnight/integration-2026-07-20 --squash   # after CI green → auto-deploys
```

No migrations tonight — no `wrangler d1 migrations apply` needed. Note: the Gate-B deploy suite runs updated journey specs included in this branch (Briefs rename + /help free-plan anchors) — product and gate land together by design.

**After the final merge + deploy:** tell Claude "landed" → live verification of every surface begins (task #17), findings become same-day fix branches.

## Decisions Nish authorized overnight (for the record)

- Public brand pages ship **indexable by default** (guards + `"0"` brake in place).
- Free weekly Competitor Watch ships **enabled** (pricing-ladder change).
- Chrome extension built; **store submission is yours** (README checklist; wait until `/ads/:domain` is deployed).

## Operator actions still open (Nish)

1. **Dodo webhook (highest priority, still open from 2026-07-18):** add `subscription.plan_changed`, `subscription.updated`, `payment.failed`, `payment.cancelled` to endpoint `ep_3DyWwxkqJjUoAInxV07esfVvUDb` filter_types AND repoint its URL from `https://0509.in/api/webhooks/dodo` to `https://0509.io/api/webhooks/dodo`. Until then, dunning emails, cancellation reversals, and partial-refund proration never fire.
2. **Pricing (authorized but physically yours — Dodo dashboard):** margin audit recommendation: change Agency ANNUAL from pay-8-months (₹120,000) to pay-9-months (₹135,000) — worst-case heavy-agency annual is ~breakeven at pay-8. Steps: Dodo dashboard → Products → create new annual Agency price at 9× monthly → note: code validates annual = 8× monthly (`dodo-pricing.server.ts`, anchor `valid_4_months_free`); tell Claude when you create the product and the validation constant gets a per-plan update in the same change. Scout/Starter prices hold (healthy margins).
3. Chrome Web Store account + submission (after `/ads/:domain` deploys).
4. Dodo customer-portal "Allow Subscription Updates" toggle (still pending from June).
5. UptimeRobot on `/api/health` (still pending from June).
5b. **Close stale PRs #344 and #345 as superseded** (audit 2026-07-20): their commits re-landed verbatim via the #347 Recovery stack on 2026-07-13 (`git cherry` patch-equivalence confirmed) and main has since improved past both (atomic branding upsert; the delivery-billing-lifecycle subsystem). Rebasing either would regress main. Suggested closing comment: "Content shipped 2026-07-13 via #347; main's versions are strictly newer. Closing as superseded." (Codex can do this with the merge duties.)
6. Codex: after the stack lands, it should rerun its claim re-proof (big claim-surface changes: free plan copy, new public pages, FAQ) and finish #353. Three specifics for Codex: (a) `spec/minor-batch` and `feat/free-weekly-watch` updated Gate-B journey specs (Briefs rename anchors; /help free-plan truth anchor) — product change + gate change land together, confirm at rebase; (b) `docs/customer-readiness-remediation.md` FABLE-PROD-001 recorded "free must never imply a recurring scan" — now superseded by the owner-authorized Free Weekly Watch; add a supersession note to the readiness ledger; (c) the readiness registry should treat the free-plan claim surface as changed.

## Queued for tomorrow (the 360° sweep — tasks #14-17)

Copywriting pass (one voice, zero beta-smell) · workflow friction audit (Cmd+K quick-add, inline actions, bulk ops) · performance pass (loader parallelization, caching, skeletons) · post-merge live verification loop until 11/10. Note: any ground-up NEW page design direction requires the Mobbin-references workflow with Nish's authenticated session (standing design policy); tonight's surfaces all extended the existing June design system.
