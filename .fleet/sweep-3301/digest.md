# Sweep digest — issue #3301 phase 5 (unbounded pre-fix prod console sweep)

- Base URL: `https://0509.io`
- Sweep window: 2026-09-12T23:45:50.226Z → 2026-09-12T23:46:41.989Z
- Vehicle: `.fleet/sweep-3301/run-sweep.mjs` — single sequential node/playwright process (no worker pool; PLAYWRIGHT_WORKERS=1 honored), headless Chromium, no retries, no filters, no caps.
- Journeys: 5 (a, b, c, d, f) × 2 viewports (desktop 1440×900 = `chromium` project, mobile 390×844 = `mobile-chromium` project) = 10 runs.

| journey | viewport | final URL | duration | console (err/warn/total) | CSP events | pageerrors | failed req | nonceless inline / total inline | vehicle error |
|---|---|---|---|---|---|---|---|---|---|
| a | desktop | https://0509.io/search?q=zzqqxx9noresult&country=all | 2.3s | 0/0/0 | 0 | 0 | 0 | 1/8 | no |
| a | mobile | https://0509.io/search?q=zzqqxx9noresult&country=all | 4.0s | 0/0/0 | 0 | 0 | 0 | 1/8 | no |
| b | desktop | https://0509.io/search?q=nike&country=all | 2.9s | 5/0/5 | 5 | 2 | 0 | 6/14 | no |
| b | mobile | https://0509.io/search?q=nike&country=all | 2.8s | 5/0/5 | 5 | 2 | 0 | 6/14 | no |
| c | desktop | https://0509.io/search?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376#selected-proof | 3.8s | 5/0/5 | 5 | 2 | 1 | 6/14 | no |
| c | mobile | https://0509.io/search?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376#selected-proof | 9.5s | 2/0/42 | 42 | 1 | 1 | 3/11 | no |
| d | desktop | https://0509.io/pricing | 3.6s | 0/0/0 | 0 | 0 | 0 | 11/11 | no |
| d | mobile | https://0509.io/pricing | 3.3s | 0/0/0 | 0 | 0 | 0 | 11/11 | no |
| f | desktop | https://0509.io/auth/signup | 3.8s | 0/0/0 | 0 | 0 | 0 | 1/8 | no |
| f | mobile | https://0509.io/auth/signup | 3.3s | 0/0/0 | 0 | 0 | 0 | 1/8 | no |

Per-run evidence: logs/<journey>-<viewport>.md + screenshots/<journey>-<viewport>.png. All findings rows in findings.md trace to those logs.
