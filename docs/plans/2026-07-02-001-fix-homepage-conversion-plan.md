---
title: "fix(marketing): Polish homepage conversion without redesigning brand"
created_at: "2026-07-02"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# fix(marketing): Polish homepage conversion without redesigning brand

## Goal Capsule

| Field | Value |
|---|---|
| Objective | Tighten the public Five to Nine homepage and pricing flow so the paid outcome is clear, premium, mobile-readable, and conversion-ready without changing the brand system. |
| Authority | The user brief is the product source of truth; repo/runtime billing gates and official Dodo, Better Auth, React Router, and Cloudflare docs constrain implementation. |
| Execution profile | Direct Codex implementation approved by Nish; keep `main` clean in a feature worktree and ship through protected PR/deploy gates only. |
| Stop conditions | Stop if Dodo annual validation, Agency hold, auth redirect safety, required review gates, or production deploy/smoke proof cannot be verified. |

---

## Product Contract

### Summary

The plan keeps the current cream/off-white, black editorial, green-proof-accent, chunky-card Five to Nine visual DNA while making the first screen and pricing section easier to understand and buy from.
The page arc stays Hero -> sample artifact -> how it works -> proof/not vibes -> product preview -> pricing -> FAQ/trust -> final CTA.

### Problem Frame

The current homepage has strong brand direction, but it is story-first before outcome-first.
The buyer needs to understand the paid result in seconds: paste competitors, then wake up to a proof-backed counter-move brief.
Pricing must remain locally priced by Dodo preview, with annual and Agency checkout fail-closed when validation or capacity proof is absent.

### Requirements

- R1. Preserve current brand DNA: cream/off-white background, black editorial type, green proof accents, chunky bordered cards, restrained brutalist/editorial feel, and current tone.
- R2. Make the hero plainly state the paid outcome with the approved promise: paste competitors and wake up to a counter-move brief.
- R3. Add or polish an early `Sample` Market Desk Brief card with what changed, why it matters, proof status, source, and next action.
- R4. Shorten repetitive/cute copy and remove unsupported Slack, WhatsApp, X, Reddit, LinkedIn, fake-logo, fake-metric, fake-testimonial, and internal implementation wording.
- R5. Keep Search V2, Presence, auth, plan gating, billing, Dodo preview pricing, Dodo annual validation, and Dodo checkout behavior intact.
- R6. Pricing must show Dodo localized prices only, must not hardcode visible amounts, and must show `4 months free` only when annual validates as eight monthly periods in the same currency/context.
- R7. Agency checkout remains held unless the fan-out proof gate opens; public copy must explain this as capacity/coverage control without exposing internal terms.
- R8. Top-up copy must say purchased proof captures never expire (they carry over until spent), included proof captures reset monthly with generous caps, and scheduled monitoring does not consume proof captures.
- R9. CTAs must have clear intent: signed-out plan intent survives signup/login, signed-in plan CTAs go to the in-app billing plan picker, sample CTAs scroll/open the sample, and no dead CTAs remain.
- R10. Accessibility and performance must retain one H1, semantic sections, keyboardable billing cycle controls, focus states, contrast, reduced motion, no layout shift, and no large animation bundle.

### Scope Boundaries

- No redesign, new palette, generic SaaS system, fake social proof, fake customer logos, fake metrics, or unsupported connector claims.
- No billing provider change, no new migration unless execution discovers a necessary schema fix, and no direct client-side Dodo/admin credential usage.
- Docs-only provenance happens after production deploy, not mixed into the feature PR.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Treat `app/routes/marketing.tsx` and existing `ld-*` / `f9-home` CSS as the page system to refine, not replace.
- KTD2. Keep pricing calculations in `app/lib/dodo-pricing.server.ts` and display helpers; homepage copy may consume validation state but must not derive or hardcode money amounts outside existing preview data.
- KTD3. Use safe same-origin redirect preservation already present in auth routes for signed-out plan intent, aligned with Better Auth callback behavior and React Router redirect safety.
- KTD4. Convert buyer-facing "records" language to "proof captures" where it describes plan/top-up buying, while preserving internal evidence usage code names unless changing them is required.
- KTD5. Add source-text tests as drift guards for claims and routing, plus focused runtime/unit tests only where behavior changes.

### Assumptions

- Existing Dodo annual validation code is the authoritative check for the annual toggle; homepage changes should surface its result, not introduce a parallel validator.
- "Agency held unless fan-out proof passed" maps to the existing commercial launch gate; public copy should avoid the phrase `fan-out`.
- Presence website/blog is GA, but social connectors remain disabled and must not be implied in public copy.

### Sources And Research

- Dodo docs: subscription products support monthly/annual intervals, and Dodo recommends separate products for pricing options such as monthly and annual.
- Better Auth docs: magic link verification redirects to the provided `callbackURL`, so preserving a validated same-origin plan picker callback is the correct auth-intent path.
- React Router docs: `redirect` can navigate to external domains, so user-supplied redirect targets must be validated before use.
- Cloudflare D1 docs: migrations are versioned SQL files and should be listed against the database name when verifying remote state.
- Repo sources: `docs/plans/2026-07-01-001-feat-commercial-delight-complete-plan.md`, `app/routes/marketing.tsx`, `app/routes/app.billing.tsx`, `app/lib/pricing.ts`, `app/lib/dodo-pricing.server.ts`, `app/lib/commercial-launch-gate.server.ts`, and marketing/pricing/billing tests.

---

## Implementation Units

### U1. Homepage Arc And Hero Clarity

- **Goal:** Replace the story-first hero with the clearer paid promise while preserving the editorial visual system.
- **Requirements:** R1, R2, R4, R9, R10.
- **Files:** `app/routes/marketing.tsx`, `app/app.css`, `tests/marketing-rebuild.test.ts`.
- **Approach:** Keep the current screenshot stack and ticker primitives, but make the text outcome-first, shorten the first viewport, and route sample/live-search CTAs intentionally.
- **Patterns to follow:** Existing `ld-hero`, `ld-command`, `ld-hero-proof-actions`, and public read-only search tests.
- **Test scenarios:** Source test confirms the new headline/subheadline, no unsupported/internal terms, one hero CTA for live search, and sample CTA points to `#demo`.
- **Verification:** Homepage source and focused marketing tests prove the visible promise and CTA intent.

### U2. Early Sample Market Desk Brief

- **Goal:** Make the early sample artifact a concise Market Desk Brief with the required fields.
- **Requirements:** R3, R4, R10.
- **Files:** `app/routes/marketing.tsx`, `app/lib/demo-proof.ts`, `app/app.css`, `tests/marketing-rebuild.test.ts`.
- **Approach:** Reuse the existing sample/proof card style, label it `Sample`, and keep proof/source/freshness language honest.
- **Patterns to follow:** Existing `demoProof.digestPreview`, `ld-case-card`, `ld-caseboard`, and `market-desk-brief` test vocabulary.
- **Test scenarios:** Source test checks `Sample Market Desk Brief`, `What changed`, `Why it matters`, `Proof status`, `Source`, and `Next action` appear before pricing and before deeper source-trail content.
- **Verification:** Focused tests and browser smoke show the sample artifact appears early and remains readable on mobile.

### U3. Pricing, Annual, Agency, Top-Ups, And CTA Flow

- **Goal:** Make pricing easier to scan while preserving Dodo-backed prices, fail-closed annual behavior, Agency hold, top-up truth, and plan intent.
- **Requirements:** R5, R6, R7, R8, R9.
- **Files:** `app/routes/marketing.tsx`, `app/lib/pricing.ts`, `app/app.css`, `tests/marketing-rebuild.test.ts`, `tests/pricing.test.ts`, existing Dodo checkout tests as needed.
- **Approach:** Reformat plan cards around limits and included value, gate annual savings copy behind `dodoAnnualSavingsIsValid`, route signed-in plan clicks to `/app/billing`, and use safe signed-out redirects through `/auth/signup`.
- **Patterns to follow:** `planIntentPath`, `app/routes/app.billing.tsx` plan picker behavior, `dodoAnnualUnavailableCopy`, and commercial launch summary.
- **Test scenarios:** Source/unit tests confirm no hardcoded prices, annual `4 months free` is tied to validation, Agency public checkout is held when sale gate is closed, purchased proof captures never expire, included proof captures reset monthly, scheduled monitoring is included, and signed-in/signed-out intent paths are correct.
- **Verification:** Focused pricing/marketing tests and build/typecheck confirm no regressions to Dodo billing code.

### U4. Visual Polish, Mobile Density, Accessibility, And Motion

- **Goal:** Reduce mobile length/density and improve scanability without redesigning the brand.
- **Requirements:** R1, R10.
- **Files:** `app/app.css`, `app/routes/marketing.tsx`, optional Playwright snapshot/support files if a local pattern exists.
- **Approach:** Tighten section padding, collapse/merge repetitive lower-page content, improve price-card hierarchy and focus states, preserve reduced-motion media queries, and avoid layout shifts.
- **Patterns to follow:** Existing `@media (max-width: ...)`, `prefers-reduced-motion`, `f9-search-page` focus-state cleanup, and chunky bordered-card language.
- **Test scenarios:** Browser smoke at desktop and mobile checks no obvious overflow/overlap, sample/pricing are reachable quickly, the annual toggle is keyboard-operable, and reduced-motion CSS remains present.
- **Verification:** Playwright/manual screenshot smoke plus `git diff --check` and full build.

### U5. Verification, Review, PR, Deploy, Smoke, And Provenance

- **Goal:** Ship through the repo's required safety gates and verify production.
- **Requirements:** R5 through R10.
- **Files:** Feature files, tests, PR body, docs-only provenance PR after deploy.
- **Approach:** Run focused tests during work, then the requested command set, pricing/prod/Search smokes, `ce-code-review`, `autoreview`, protected PR, one deploy, live smokes, and docs-only provenance.
- **Patterns to follow:** Repo protected PR release workflow, `npm run deploy`, `.dev.vars` canary token source, and existing launch/canary scripts.
- **Test scenarios:** Requested verification commands pass or produce a stated blocker; production home, pricing, annual toggle, CTAs, `/search`, and `/api/health` are smoked after deploy.
- **Verification:** PR merge commit, runtime commit, Worker version, rollback version, and remaining experiments are reported.

---

## Verification Contract

| Gate | Done Signal |
|---|---|
| Focused source/unit tests | Marketing, pricing, Dodo annual, CTA, top-up, and Agency guard tests pass after each behavior slice. |
| Required local gates | `npm test`, `npm run typecheck`, `npm run build`, `node scripts/validate-d1-backup.mjs`, `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations list 0509 --remote`, and `git diff --check` pass or a blocker is reported. |
| Smokes | Pricing/prod/Search smokes run before merge/deploy, and production home/pricing/annual/CTA/search/health smokes run after deploy. |
| Reviews | `ce-code-review` and `autoreview` run on the exact change before protected PR merge/deploy; real findings are fixed and rerun. |
| Browser/accessibility | Desktop and mobile browser checks show readable layout, no text overlap, keyboardable controls, visible focus, and reduced motion respected. |

---

## Definition of Done

- Homepage hero immediately explains the paid outcome and keeps the current brand system.
- Sample Market Desk Brief appears early, is labeled `Sample`, and shows proof/source/next-action fields.
- Pricing cards are scanable, Dodo-backed, annual-fail-closed, and Agency-held when capacity proof is absent.
- Buyer-facing top-up language says purchased proof captures never expire (carry over until spent), included proof captures reset monthly with generous caps, and scheduled monitoring does not consume proof captures.
- Unsupported connector/social claims and internal implementation terms are absent from public homepage/pricing copy.
- Signed-out plan intent survives signup/login; signed-in plan CTAs route to the app billing picker.
- Requested tests, smokes, review gates, PR, deploy, production smoke, and docs-only provenance are complete or explicitly blocked with evidence.
