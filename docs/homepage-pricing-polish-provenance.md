# Homepage and Pricing Polish Provenance

## Release

- App PR: #294, `fix(marketing): polish homepage conversion without redesigning brand`
- Feature branch: `fix/marketing-homepage-pricing-polish`
- Feature commit: `e42fe667d822a60dcb0af1f362ffefb32206419e`
- App merge commit: `e31fdf38e779126318ef70085ca5a4e06d094ace`
- Follow-up PR: #296, `fix(billing): keep held plan checkout out of Agency copy`
- Final runtime commit: `34b31cdc5b8d627da8412b345c60c7da3da22795`
- Production deploy: 2026-07-02 after PR #296 merge
- Worker version: `8a79ca90-4f19-4b2c-bdfe-09f95857cc65`, 100%
- Rollback version: `a1506e3e-a541-45c1-ad56-eafb7b53b7c5`, 100%

## Scope Preserved

- Preserved the existing Five to Nine visual DNA: cream/off-white background, black editorial type, green proof accents, chunky bordered cards, and restrained brutalist/editorial tone.
- Kept Search V2, Presence, auth, billing, plan gating, Dodo pricing, and existing runtime gates intact.
- Removed unsupported public claims around disabled social connectors and internal terms from customer-facing homepage/pricing copy.

## Verification

- `npm test`: 165 files, 1667 tests passed after the billing fallback regression was added.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `node scripts/validate-d1-backup.mjs`: passed in dry-run mode through migration `0062_dodo_plan_change_pending_target.sql`.
- `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations list 0509 --remote`: no migrations to apply.
- `git diff --check HEAD`: passed before commit.
- `npm run canary:pricing`: passed after deploy for IN, US, and GB across monthly, annual, Agency, and top-ups.
- `npm run canary:billing`: passed after deploy for plan webhook, proof-credit webhook, and cleanup.
- `npm run canary:prod -- --query example.com`: passed after deploy for all production health domains, fresh-live bypass, ops readiness, and Meta ads beta.
- `npm run provider:bakeoff:launch`: passed after deploy for current 0509 live Search queries `nykaa`, `boat`, `mamaearth`, `swiggy`, `zomato`, and `meesho`; optional alternate providers were skipped because their tokens are not configured.
- Rendered browser smoke after deploy: homepage, sample artifact, annual toggle, signed-out plan intent, mobile overflow, `/search`, `/api/health`, and sanitized `/api/pricing-preview` all passed.
- Autoreview: the first merged app-commit review found a billing fallback issue; PR #296 fixed it, and the follow-up staged diff autoreview exited clean with no accepted/actionable findings.
- Cursor Bugbot: attempted on PR #294 and PR #296, but Cursor reported usage limit reached both times. No Bugbot findings were produced.

## Notes

- This provenance PR is docs-only and should not be redeployed. The deployed runtime remains `34b31cdc5b8d627da8412b345c60c7da3da22795`.

## Design QA Follow-up

- App PR: #298, `fix(marketing): polish homepage conversion without redesigning brand`
- Feature branch: `codex/homepage-design-qa`
- Feature commit: `1495f9fae8158c0b2d5fc5b067b4fd30bf9b2b5d`
- App merge commit / runtime commit: `c50c22a7d8963867e6c0c6d8c0577d8378072e98`
- Production deploy: 2026-07-02 after PR #298 merge
- Worker version: `d56f073b-05a3-4248-98c3-1875da9b4553`, 100%
- Rollback version: `8a79ca90-4f19-4b2c-bdfe-09f95857cc65`, 100%

### Scope

- Preserved the existing Five to Nine brand system: cream/off-white background, black editorial type, green proof accents, chunky borders, and restrained brutalist/editorial tone.
- Tightened the homepage design QA issues raised from screenshots: over-rounded black CTA pills, overly broad hero input treatment, dense mobile cards, pricing card wrapping, and mobile CTA readability.
- Kept Dodo-backed pricing, annual validation, signed-out plan intent, Search V2, Presence, auth, billing, and plan gating intact.

### Verification

- Local feature verification before PR: `npm test`, `npm run typecheck`, `npm run build`, `node scripts/validate-d1-backup.mjs`, `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations list 0509 --remote`, `git diff --check`, `npm run canary:pricing`, `npm run canary:billing`, `npm run canary:prod`, `npm run provider:bakeoff:launch`, and `npm run check:public-home` passed.
- Rendered design QA before merge: homepage desktop/mobile screenshots, mobile overflow checks, annual toggle behavior, CTA targets, pricing card wrapping, and sample artifact readability passed.
- Autoreview: first review found a URL input regression; the fields were reverted to text inputs with URL keyboard hints, and the final pushed diff autoreview exited clean with no accepted/actionable findings.
- Bugbot: `bugbot-gate status` returned `SKIP BUGBOT` for normal-risk diff; the GitHub PR Cursor Bugbot check completed as neutral/skipping.
- PR #298 CI: Gitleaks passed, `codex-node-checks` passed, Cursor Bugbot was neutral/skipping.
- Post-deploy checks: `npm run check:public-home`, `npm run canary:pricing`, `npm run canary:billing`, and `npm run canary:prod` passed with the local canary token loaded.
- Post-deploy rendered smoke: homepage, single H1, sample artifact, Create account / Sign in CTAs, annual pricing toggle, signed-out plan intent, `/search`, `/api/health`, and mobile horizontal overflow all passed.

### Notes

- This provenance update is docs-only and should not be redeployed. The deployed runtime remains `c50c22a7d8963867e6c0c6d8c0577d8378072e98`.
