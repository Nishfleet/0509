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
