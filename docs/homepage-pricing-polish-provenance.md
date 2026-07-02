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
