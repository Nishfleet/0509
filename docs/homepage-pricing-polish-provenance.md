# Homepage and Pricing Polish Provenance

## Release

- App PR: #294, `fix(marketing): polish homepage conversion without redesigning brand`
- Feature branch: `fix/marketing-homepage-pricing-polish`
- Feature commit: `e42fe667d822a60dcb0af1f362ffefb32206419e`
- Protected squash merge/runtime commit: `e31fdf38e779126318ef70085ca5a4e06d094ace`
- Production deploy: 2026-07-02 after PR #294 merge
- Worker deployment: `d2c6226d-e454-4ea8-9fe4-a0074507fdeb`
- Worker version: `a1506e3e-a541-45c1-ad56-eafb7b53b7c5` (#403), 100%
- Rollback deployment: `d5ade0f4-9a01-432f-a864-e69186c8afe4`
- Rollback version: `bced0e5b-b181-42b0-93a1-8977e6d268f2` (#402), 100%

## Scope Preserved

- Preserved the existing Five to Nine visual DNA: cream/off-white background, black editorial type, green proof accents, chunky bordered cards, and restrained brutalist/editorial tone.
- Kept Search V2, Presence, auth, billing, plan gating, Dodo pricing, and existing runtime gates intact.
- Removed unsupported public claims around disabled social connectors and internal terms from customer-facing homepage/pricing copy.

## Verification

- `npm test`: 165 files, 1666 tests passed.
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
- Autoreview: clean after accepted findings were fixed and regression tests were added.
- Cursor Bugbot: `bugbot-gate` recommended one run; `/review-bugbot` was posted on PR #294; GitHub reported Cursor Bugbot as neutral/skipping, with no findings posted.

## Notes

- This provenance PR is docs-only and should not be redeployed. The deployed runtime remains `e31fdf38e779126318ef70085ca5a4e06d094ace`.
