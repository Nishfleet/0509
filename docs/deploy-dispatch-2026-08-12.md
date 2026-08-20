# Production deploy dispatch — 2026-08-12

## Dispatch

- **Workflow**: `.github/workflows/deploy-production.yml` (`Deploy production`)
- **Run**: https://github.com/Nishfleet/0509/actions/runs/31534318744
- **Event**: `workflow_dispatch`
- **Ref**: `refs/heads/main`
- **`expected_sha`**: `389c0e550e3e335c386c498ce59779868088a5b7` (current `origin/main`)
- **`backup_proof_status`**: `required`
- **`deferred_backup_authorization`**: empty

## Why a dispatch was needed

The last successful production deploy was run 31319791367 for `8a3b9daa`
(2026-08-09). Everything merged since then — including the three customer
fixes tracked since the 2026-08-09 scout (#583, #582, #567) and a further 32
commits — is still waiting in the deploy queue.

Every deploy run since `5e682868` failed in sequence, each for a different
reason, and each was unblocked by a merged fix before the next dispatch:

1. GitHub-hosted runner billing block (account-level) — fixed by routing
   `deploy-production.yml` onto the self-hosted `vps-verify` runners
   (PR #585 / #581).
2. Production CAS drift (`provider_main_cas_invalid: remote_main_drift`) and
   canary-secret sync failures — fixed by #630
   (`ci(deploy): unblock production CAS mid-pipeline drift and canary sync`).
3. Production Typecheck heap exhaustion (exit 134) — fixed by #623
   (`ci(deploy): give the production Typecheck the heap ci.yml already gives it`).
4. `launch:readiness:predeploy` failing on the release-readiness manifest with
   `strictIssues=["browser_hydration_error:console","browser_run_failed"]` —
   all 73 Gate-B journeys pass, but the Gate B manifest fails closed when any
   page fires a React hydration error. The non-blocking Google Fonts pattern
   (`FONT_SWAP_SCRIPT`) flips `media="print"` to `"all"` on
   `#f9-font-stylesheet`; when css2 is already cached (common under release
   readiness preloads), that attribute write lands before React hydrates and
   trips `browser_hydration_error:console`. Fixed by #647
   (`fix(fonts): stop print→all stylesheet swap from failing hydration`),
   which adds `suppressHydrationWarning` on the stylesheet link (same pattern
   as `THEME_BOOT_SCRIPT`) and applies the swap immediately when
   `link.sheet` is already set. This dispatch runs the exact commit that
   contains #647's fix (`389c0e55`), so the readiness gate should now pass.

## Customer fixes leaving the queue with this deploy

- #583 — keep the refine disclosure shut on a pristine /search (BL-031)
- #582 — pin undici 7.29.0
- #567 — gate public /search "right now" promise on a proven fresh-live Ad
  Library capture

…plus every commit merged to main since `8a3b9daa` (2026-08-09), including
#579 (honest anonymous form error/status states), #610 (CSP Web Analytics
beacon), #611/#647 (non-blocking fonts), #613 (AI crawler policy), #616 (no
silent geo country commit), #620 (live-claim window), #621 (Ad Library country),
#623/#630 (deploy unblocks), #624 (venue submissions), #625 (proof capture
label SSR parity), #638 (Meta ads graduation).

## Result

**Success** — run 31534318744 completed green at 2026-08-12 02:50 IST
(2026-08-11 21:20:23Z), dispatching `389c0e55` to production.

- All six jobs finished: authorize, pin, prepare D1 remote restore evidence,
  and Deploy Worker succeeded (29m47s); generate/cleanup restore evidence
  skipped as expected because pre-generated exact evidence was valid.
- Release evidence archived and preserved:
  `production-release-evidence-389c0e55…-31534318744-1` and
  `d1-remote-restore-evidence-389c0e55…-31534318744` artifacts uploaded.
- The three customer fixes tracked by the 2026-08-09 scout (#583, #582, #567)
  plus all 32 commits since `8a3b9daa` are now live. Verified at the time of
  writing: `https://0509.io/` serves HTTP 200 (www redirects to apex as
  configured).
