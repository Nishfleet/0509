# Lane evidence — issue #2971 (outside-in hygiene sweep)

Unit: pi-issue-0509-2971. Branch: claim/issue-2971.

## What the issue asked

Four outside-visible items from the 2026-09-11 blind audits:
1. robots.txt comments cite internal issue numbers + repo doc paths.
2. `create-chat-completion` constant in assets/*.js pointing at a dead endpoint.
3. `dig CAA 0509.io` empty.
4. CSP style-src carries 'unsafe-inline' while script-src is nonced.

## Outcome per item

1. FIXED. Served `ROBOTS_TXT` comments in app/lib/seo.ts no longer name
   `Issue #2061 / #1459`, `Issue #2043`, `(issue #2061)` or
   `docs/ai-crawler-policy.md`. Same leak class found and fixed in llms.txt
   (app/lib/public-markdown.ts dropped "- This policy is decided and recorded
   in docs/ai-crawler-policy.md."). Reasoning refs stay in code comments —
   code comments are not served.
2. NOT REPRODUCIBLE — nothing to fix. `create-chat-completion` is absent from
   repo source, the entire git history (`git log --all -S`), node_modules,
   the Sep-6 local build (client+server), and all 297 JS assets in the live
   deployed manifest (fetched and grepped). The "endpoint 404/405" signature
   is generic — every unknown /api/* path answers GET 404 / POST 405.
   Verified: `/api/create-chat-completion`, `/api/foo`, `/api/nonexistent-xyz`
   all return 404/405 identically. Likely a stale cached asset at audit time.
3. SPLIT → #3061. Adding a CAA record is a Cloudflare zone DNS change — a
   production provider mutation reserved for Nish. No DNS-as-code exists in
   this repo to PR against. The follow-up carries the suggested record set
   (live cert issuer is Google Trust Services WE1, verified via openssl
   s_client 2026-09-12).
4. FIXED via CSP3 split. `style-src 'self' https://fonts.googleapis.com`
   (no 'unsafe-inline') + `style-src-attr 'unsafe-inline'`. <style> elements
   and <link> fall back to style-src → injected <style> now blocked. `style=`
   attributes stay allowed because /sample-brief renders stored digest email
   markup via dangerouslySetInnerHTML. The one <style> element served under
   the CSP — the branded PDF error page in app/lib/report-pdf.server.ts —
   was converted to style= attributes. Pre-2022 browsers without
   style-src-attr fall back to style-src and render those attributes
   unstyled; documented in workers/security-headers.ts.

## Proof

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 366 files / 4430 tests, all green.
- Targeted: tests/seo.test.ts, robots-aeo-policy.test.ts,
  public-markdown.test.ts, worker-security-headers.test.ts → 62/62 green.
- Rendered ROBOTS_TXT locally → no issue refs / repo paths.
- sgscan → "No new security findings."
- crgate → exit 3, CodeRabbit not signed in on this machine (env gap, flagged
  not hidden). Product-repo reviewer round covers independent review.

## Re-entrant run — 2026-09-13 (same unit, second claim)

The 2026-09-12 run died before pushing (claim released
2026-09-13T04:49:37Z, no open PR). This claim salvaged its banked work:
cherry-picked 6956292da onto a fresh claim/issue-2971 built on
1cc79b200 (main had moved +354 commits; git auto-merged clean).

Semantic-conflict sweep after the auto-merge (354 commits of drift): final
security-headers.ts re-read — style-src / style-src-attr pair intact, the
per-request CSP patch only rewrites the script-src and connect-src segments;
no new `<style` element anywhere in the served tree (only a comment and the
sanitize-text regex); served ROBOTS_TXT and llms.txt templates still leak-free
on the merged tree; the merged test expectations match the final CSP exactly.

Item-2 re-verification against TODAY's deployment (unmasked exits — the first
probe printed `head`'s exit, the fleet-ops#1193 trap; re-run properly):
0 of 25 unique JS bundles referenced by the live homepage contain
`create-chat-completion` (each fetched 200 OK, grepped); the constant is
absent from the worktree source (`rg -c` exit 1) and from all history except
these evidence notes themselves (`git log --all -S` matches are only this
report's own additions in the three salvage/cherry-pick commits).
`GET /api/create-chat-completion` → 404. Finding stays NOT reproducible.

Live truth 2026-09-13 (pre-merge, all expected to clear on this PR's deploy):
/robots.txt still serves `Issue #2061 / #1459`, `Issue #2043`,
`docs/ai-crawler-policy.md`, `(issue #2061)`; CSP still carries
`style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`; `dig +short
CAA 0509.io` still empty (→ #3061, OPEN).

Gates this run:

- Targeted (same 4 files) → 65/65 green.
- `--changed origin/main` (vitest affected-tests mode) → 389 files /
  4681 tests, all green, 95s. Workers project not in scope: no
  migrations/** or tests/integration/** changes.
- sgscan → "No new security findings.", exit 0.
- crgate → exit 3, "CodeRabbit is not signed in on this machine. Run:
  coderabbit auth login"; `coderabbit auth login` → "Non-interactive
  environment detected. Use --api-key" and no CODE*RABBIT* key is
  provisioned for this seat (checked, names only — no secret printed).
  Env gap, flagged not hidden; disclosed in the PR body loose-ends.
- VITEST_MAX_WORKERS=2 / PLAYWRIGHT_WORKERS=1 respected; no --coverage,
  no typecheck (CI owns both). One heavy toolchain at a time.
