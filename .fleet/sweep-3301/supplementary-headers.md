# Supplementary response-header probe — AFTER the sweep (explains the report-only CSP variance)

- Sweep window: 2026-09-12T23:36:01Z → 2026-09-12T23:46:41Z (run-sweep.mjs). This probe: 2026-09-12T23:53:15Z — NOT part of the 10 journeys; explanatory only. The 10-run evidence above stands exactly as captured.
- Question it answers: the report-only CSP (disposition: report, originalPolicy `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/...`) fired in exactly 1 of 10 journeys (c-mobile). Is that policy still being served, and does it correlate with Cloudflare cache state?
- Method: for each of the 5 final URLs, 3× sequential curls; recording ONLY: CF-Cache-Status, presence of Content-Security-Policy and Content-Security-Policy-Report-Only (and the RO policy's script-src + whether it carries a nonce).

- https://0509.io/search?q=zzqqxx9noresult&country=all (try 1): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: nonce-IdyqvPN/Ed2mhysA/IoeLe6B (1 nonce tokens)
- https://0509.io/search?q=zzqqxx9noresult&country=all (try 2): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: nonce-4iij2k2UIxed2BI2g1AFO/IO (1 nonce tokens)
- https://0509.io/search?q=zzqqxx9noresult&country=all (try 3): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: nonce-QYpSCVufWWaMLzWS+eYTXlcB (1 nonce tokens)
- https://0509.io/search?q=nike&country=all (try 1): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: nonce-R6MTLXuYLuwNFRVmzZBRO7wa (1 nonce tokens)
- https://0509.io/search?q=nike&country=all (try 2): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: nonce-Q9R/0bdLYRGxzHHLKbfDUWPx (1 nonce tokens)
- https://0509.io/search?q=nike&country=all (try 3): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: nonce-XGJyzlIMM0KTjk45+UG2A7n+ (1 nonce tokens)
- https://0509.io/pricing (try 1): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: none (0
0 nonce tokens)
- https://0509.io/pricing (try 2): CF-Cache-Status=HIT ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: none (0
0 nonce tokens)
- https://0509.io/pricing (try 3): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: none (0
0 nonce tokens)
- https://0509.io/auth/signup (try 1): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: nonce-Vb3l3CtOGaggAXtjvwdFu0q2 (1 nonce tokens)
- https://0509.io/auth/signup (try 2): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: nonce-ltpWk90QNEunqJSSAZ65Vc// (1 nonce tokens)
- https://0509.io/auth/signup (try 3): CF-Cache-Status= ; CSP headers: 1 ; no report-only header ; 1st enforce nonce: nonce-fcYRjES5UXSizNYhfOqdn25R (1 nonce tokens)
