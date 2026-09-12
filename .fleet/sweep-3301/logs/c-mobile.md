# Journey c — mobile (mobile 390×844)

- Journey: (c) selected proof — populated + click first result row → ?selected= (initial navigation: `/search?q=nike&country=all`)
- Base URL: `https://0509.io` (E2E_PROD_BASE_URL; production, pre-fix at sweep time)
- Context: `...devices["Desktop Chrome"]` + viewport 390×844 + isMobile + hasTouch — exactly the playwright.config.ts `mobile-chromium` project's use block; headless; deviceScaleFactor 1; UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Safari/537.36`
- Process: single sequential node/playwright process, no worker pool (PLAYWRIGHT_WORKERS=1 honored); no retries.
- Started: 2026-09-12T23:46:13.176Z — Finished: 2026-09-12T23:46:22.670Z (duration 9.5s)
- **Final URL: https://0509.io/search?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376#selected-proof**
- Main-frame navigation response chain (final response, walked backwards through redirect hops):

1. 200 → https://0509.io/search?q=nike&country=all

## Counts (unbounded — every record below is complete, nothing truncated)

- console records: 42 total (error: 2, warning: 0, other: 40)
- securitypolicyviolation events: 42
- pageerror events: 1
- failed requests: 1
- document-type responses seen: 1
- journey completed without vehicle error

## ALL console messages (full text)

1. `[info]` Loading the script 'https://0509.io/assets/entry.client-DEbsgXS4.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
2. `[info]` Loading the script 'https://0509.io/assets/react-OrosJ8bI.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
3. `[info]` Loading the script 'https://0509.io/assets/components-C6MkEFrU.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
4. `[info]` Loading the script 'https://0509.io/assets/errorBoundaries-CQyl6ArF.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
5. `[info]` Loading the script 'https://0509.io/assets/jsx-runtime-CZFPacut.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
6. `[info]` Loading the script 'https://0509.io/assets/root-C-6D5TIZ.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
7. `[info]` Loading the script 'https://0509.io/assets/lib-BHELyrr3.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
8. `[info]` Loading the script 'https://0509.io/assets/support-DKAHue7Y.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
9. `[info]` Loading the script 'https://0509.io/assets/locale-markets-DsRBPfAe.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
10. `[info]` Loading the script 'https://0509.io/assets/theme-client-CutkeodU.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
11. `[info]` Loading the script 'https://0509.io/assets/search-CMcb3RTH.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
12. `[info]` Loading the script 'https://0509.io/assets/search-njY7Xv_X.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
13. `[info]` Loading the script 'https://0509.io/assets/marketing-nav-D19kAem_.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
14. `[info]` Loading the script 'https://0509.io/assets/submit-button-R9jr2vEA.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
15. `[info]` Loading the script 'https://0509.io/assets/seo-SsNYe7L_.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
16. `[info]` Loading the script 'https://0509.io/assets/ad-thumb-B9FqhG5N.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
17. `[info]` Loading the script 'https://0509.io/assets/customer-route-error-BPI1uV8o.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
18. `[info]` Loading the script 'https://0509.io/assets/dashboard-shell-CcPACRy8.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
19. `[info]` Loading the script 'https://0509.io/assets/ruled-list-BR906_ZM.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
20. `[info]` Loading the script 'https://0509.io/assets/angle-display-B9fIE81B.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
21. `[info]` Loading the script 'https://0509.io/assets/ad-display-Ds28mbD6.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
22. `[info]` Loading the script 'https://0509.io/assets/landing-page-display-BnAoAxaC.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
23. `[info]` Loading the script 'https://0509.io/assets/countries-D0yVsw8K.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
24. `[info]` Loading the script 'https://0509.io/assets/discovery-customer-copy-CHQYLR6x.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
25. `[info]` Loading the script 'https://0509.io/assets/trust-proof-note-CoeoSQua.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
26. `[info]` Loading the script 'https://0509.io/assets/competitor-website-CmDc6EsJ.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
27. `[info]` Loading the script 'https://0509.io/assets/detail-pane-zpYaRpSk.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
28. `[info]` Loading the script 'https://0509.io/assets/feedback-strip-xtiZyNTy.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
29. `[info]` Loading the script 'https://0509.io/assets/working-header-BRO6Owyz.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
30. `[info]` Loading the script 'https://0509.io/assets/brand-wordmark-B5ABHERK.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
31. `[info]` Loading the script 'https://0509.io/assets/pricing-DByQjAFG.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
32. `[info]` Loading the script 'https://0509.io/assets/plan-entitlements-BPuX-mgd.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
33. `[info]` Loading the script 'https://0509.io/assets/cta-DcIZK57d.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
34. `[info]` Loading the script 'https://0509.io/assets/sign-out-button-DWzZ_04k.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
35. `[info]` Loading the script 'https://0509.io/assets/public-brand-name-BXyheF1Y.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
36. `[info]` Loading the script 'https://0509.io/assets/capture-validity-public-rules-BB0pogtd.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/search?q=nike&country=all:0:0
37. `[error]` Executing inline script violates the following Content Security Policy directive 'script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-CxjgYYTDUt0EnAzBuv7p+YnT''. Either the 'unsafe-inline' keyword, a hash ('sha256-7mu4H06fwDCjmnxxr/xNHyuQC6pLTHr4M2E4jXw5WZs='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
   - location: https://0509.io/search?q=nike&country=all:261:0
38. `[error]` Executing inline script violates the following Content Security Policy directive 'script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-CxjgYYTDUt0EnAzBuv7p+YnT''. Either the 'unsafe-inline' keyword, a hash ('sha256-QAlSewaQLi/NPCznjAZSyvQ72heD0VdxmNDDkZeCxgc='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
   - location: https://0509.io/search?q=nike&country=all:261:0
39. `[info]` Connecting to 'https://0509.io/__manifest?paths=%2Fads%2C%2Fads%2Fnike.com%2C%2Fauth%2C%2Fauth%2Flogin%2C%2Fauth%2Fsignup%2C%2Fbrands%2C%2Fcapture-rules%2C%2Fcompare%2C%2Fdocs%2C%2Fhelp%2C%2Fno-phantom-changes%2C%2Fpricing%2C%2Fsample-brief%2C%2Fsearch%2C%2Fstatus%2C%2Fswitch%2C%2Fswitch%2Fadspy%2C%2Fswitch%2Fmagicbrief%2C%2Fswitch%2Fpanoramata%2C%2Fswitch%2Fvisualping&version=2c37675d' violates the following Content Security Policy directive: "connect-src 'none'". The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/assets/errorBoundaries-CQyl6ArF.js:1:0
40. `[info]` Connecting to 'https://0509.io/__manifest?paths=%2Fads%2C%2Fads%2Fnike.com%2C%2Fauth%2C%2Fauth%2Flogin%2C%2Fauth%2Fsignup%2C%2Fbrands%2C%2Fcapture-rules%2C%2Fcompare%2C%2Fdocs%2C%2Fhelp%2C%2Fno-phantom-changes%2C%2Fpricing%2C%2Fsample-brief%2C%2Fsearch%2C%2Fstatus%2C%2Fswitch%2C%2Fswitch%2Fadspy%2C%2Fswitch%2Fmagicbrief%2C%2Fswitch%2Fpanoramata%2C%2Fswitch%2Fvisualping&version=2c37675d' violates the following Content Security Policy directive: "connect-src 'none'". The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/assets/errorBoundaries-CQyl6ArF.js:1:0
41. `[info]` Connecting to 'https://0509.io/search.data?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376' violates the following Content Security Policy directive: "connect-src 'none'". The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/assets/errorBoundaries-CQyl6ArF.js:1:0
42. `[info]` Connecting to 'https://0509.io/search.data?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376' violates the following Content Security Policy directive: "connect-src 'none'". The policy is report-only, so the violation has been logged but no further action has been taken.
   - location: https://0509.io/assets/errorBoundaries-CQyl6ArF.js:1:0

## securitypolicyviolation events (ALL fields)

1. **script-src-elem** blocked **https://0509.io/assets/entry.client-DEbsgXS4.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
2. **script-src-elem** blocked **https://0509.io/assets/react-OrosJ8bI.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
3. **script-src-elem** blocked **https://0509.io/assets/components-C6MkEFrU.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
4. **script-src-elem** blocked **https://0509.io/assets/errorBoundaries-CQyl6ArF.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
5. **script-src-elem** blocked **https://0509.io/assets/jsx-runtime-CZFPacut.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
6. **script-src-elem** blocked **https://0509.io/assets/root-C-6D5TIZ.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
7. **script-src-elem** blocked **https://0509.io/assets/lib-BHELyrr3.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
8. **script-src-elem** blocked **https://0509.io/assets/support-DKAHue7Y.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
9. **script-src-elem** blocked **https://0509.io/assets/locale-markets-DsRBPfAe.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
10. **script-src-elem** blocked **https://0509.io/assets/theme-client-CutkeodU.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
11. **script-src-elem** blocked **https://0509.io/assets/search-CMcb3RTH.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
12. **script-src-elem** blocked **https://0509.io/assets/search-njY7Xv_X.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
13. **script-src-elem** blocked **https://0509.io/assets/marketing-nav-D19kAem_.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
14. **script-src-elem** blocked **https://0509.io/assets/submit-button-R9jr2vEA.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
15. **script-src-elem** blocked **https://0509.io/assets/seo-SsNYe7L_.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
16. **script-src-elem** blocked **https://0509.io/assets/ad-thumb-B9FqhG5N.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
17. **script-src-elem** blocked **https://0509.io/assets/customer-route-error-BPI1uV8o.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
18. **script-src-elem** blocked **https://0509.io/assets/dashboard-shell-CcPACRy8.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
19. **script-src-elem** blocked **https://0509.io/assets/ruled-list-BR906_ZM.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
20. **script-src-elem** blocked **https://0509.io/assets/angle-display-B9fIE81B.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
21. **script-src-elem** blocked **https://0509.io/assets/ad-display-Ds28mbD6.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
22. **script-src-elem** blocked **https://0509.io/assets/landing-page-display-BnAoAxaC.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
23. **script-src-elem** blocked **https://0509.io/assets/countries-D0yVsw8K.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
24. **script-src-elem** blocked **https://0509.io/assets/discovery-customer-copy-CHQYLR6x.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
25. **script-src-elem** blocked **https://0509.io/assets/trust-proof-note-CoeoSQua.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
26. **script-src-elem** blocked **https://0509.io/assets/competitor-website-CmDc6EsJ.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
27. **script-src-elem** blocked **https://0509.io/assets/detail-pane-zpYaRpSk.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
28. **script-src-elem** blocked **https://0509.io/assets/feedback-strip-xtiZyNTy.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
29. **script-src-elem** blocked **https://0509.io/assets/working-header-BRO6Owyz.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
30. **script-src-elem** blocked **https://0509.io/assets/brand-wordmark-B5ABHERK.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
31. **script-src-elem** blocked **https://0509.io/assets/pricing-DByQjAFG.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
32. **script-src-elem** blocked **https://0509.io/assets/plan-entitlements-BPuX-mgd.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
33. **script-src-elem** blocked **https://0509.io/assets/cta-DcIZK57d.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
34. **script-src-elem** blocked **https://0509.io/assets/sign-out-button-DWzZ_04k.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
35. **script-src-elem** blocked **https://0509.io/assets/public-brand-name-BXyheF1Y.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
36. **script-src-elem** blocked **https://0509.io/assets/capture-validity-public-rules-BB0pogtd.js** (disposition report, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 1  columnNumber: 0
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
37. **script-src-elem** blocked **inline** (disposition enforce, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 262  columnNumber: 0
   - sample: ``
   - originalPolicy: `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-CxjgYYTDUt0EnAzBuv7p+YnT'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
38. **script-src-elem** blocked **inline** (disposition enforce, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 262  columnNumber: 0
   - sample: ``
   - originalPolicy: `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-CxjgYYTDUt0EnAzBuv7p+YnT'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
39. **connect-src** blocked **https://0509.io/__manifest?paths=%2Fads%2C%2Fads%2Fnike.com%2C%2Fauth%2C%2Fauth%2Flogin%2C%2Fauth%2Fsignup%2C%2Fbrands%2C%2Fcapture-rules%2C%2Fcompare%2C%2Fdocs%2C%2Fhelp%2C%2Fno-phantom-changes%2C%2Fpricing%2C%2Fsample-brief%2C%2Fsearch%2C%2Fstatus%2C%2Fswitch%2C%2Fswitch%2Fadspy%2C%2Fswitch%2Fmagicbrief%2C%2Fswitch%2Fpanoramata%2C%2Fswitch%2Fvisualping&version=2c37675d** (disposition report, statusCode 200)
   - violatedDirective: `connect-src`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/assets/errorBoundaries-CQyl6ArF.js`  lineNumber: 2  columnNumber: 21564
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
40. **connect-src** blocked **https://0509.io/__manifest?paths=%2Fads%2C%2Fads%2Fnike.com%2C%2Fauth%2C%2Fauth%2Flogin%2C%2Fauth%2Fsignup%2C%2Fbrands%2C%2Fcapture-rules%2C%2Fcompare%2C%2Fdocs%2C%2Fhelp%2C%2Fno-phantom-changes%2C%2Fpricing%2C%2Fsample-brief%2C%2Fsearch%2C%2Fstatus%2C%2Fswitch%2C%2Fswitch%2Fadspy%2C%2Fswitch%2Fmagicbrief%2C%2Fswitch%2Fpanoramata%2C%2Fswitch%2Fvisualping&version=2c37675d** (disposition report, statusCode 200)
   - violatedDirective: `connect-src`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/assets/errorBoundaries-CQyl6ArF.js`  lineNumber: 2  columnNumber: 21564
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
41. **connect-src** blocked **https://0509.io/search.data?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376** (disposition report, statusCode 200)
   - violatedDirective: `connect-src`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/assets/errorBoundaries-CQyl6ArF.js`  lineNumber: 2  columnNumber: 7176
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`
42. **connect-src** blocked **https://0509.io/search.data?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376** (disposition report, statusCode 200)
   - violatedDirective: `connect-src`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/assets/errorBoundaries-CQyl6ArF.js`  lineNumber: 2  columnNumber: 7176
   - sample: ``
   - originalPolicy: `script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; report-uri https://csp-reporting.cloudflare.com/cdn-cgi/script_monitor/report?m=iLL5whi8_kELAPjKbY8awwli3N6Id_Ks.Hc.jJQs2ZQ-1789256773.7179365-1.0.1.1-po7z60tCzEjRk1vx91.6GX3SvVlqVsbi7M45PDWd3zQ15azaR.1mDy7dunBXhLYzgwXkoOsrWudIShvNfcckUFzxVeuTyOnO_f7rjbS.ikrSV_MGvYjZ2ZNUBuYLG1iYIYtsVgxe41aWXiL8L58_m9zohF.wFHlbBZQttshmbkI; report-to cf-csp-endpoint`

## pageerror events (full text + stack)

1. **Error**: Minified React error #419; visit https://react.dev/errors/419 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.
   - stack: ``

## document-type responses (all, incl. iframes; Location = redirect hop)

1. 200 https://0509.io/search?q=nike&country=all — frame: about:blank

## failed requests (all)

1. https://0509.io/search.data?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376 — net::ERR_ABORTED (other)

## Raw-HTML inline-script inventory of the FINAL URL (this response's own CSP nonce)

- raw fetch: 200 https://0509.io/search?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376#selected-proof
- Content-Security-Policy (full): `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-yH+5xPNSExfOht+JNiYIsihy'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
- script-src directive: `script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-yH+5xPNSExfOht+JNiYIsihy'`
- nonce tokens in policy: 1; 'unsafe-inline' present: false; 'sha256-' hashes present: false
- ALL <script> tags: 11; src-less (inline) of those: 11
- per src-less (inline) script: attrs + first 140 chars of body + nonce verdict
  1. attrs: `nonce="yH+5xPNSExfOht+JNiYIsihy"`
     body@140: `(function(){try{var s=null;try{s=localStorage.getItem("f9-theme")}catch(e){}var d=s==="dark"||(s!=="light"&&window.matchMedia&&window.matchM`
     carries THIS response's CSP nonce (undefined): yes
  2. attrs: `nonce="yH+5xPNSExfOht+JNiYIsihy"`
     body@140: `(function(){try{var l=document.getElementById("f9-font-stylesheet");if(!l)return;function apply(){l.media="all";}if(l.addEventListener){l.ad`
     carries THIS response's CSP nonce (undefined): yes
  3. attrs: `type="application/ld+json"`
     body@140: `{"@context":"https://schema.org","@type":"WebPage","@id":"https://0509.io/search","url":"https://0509.io/search","name":"Search competitor M`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← application/ld+json
  4. attrs: `nonce="yH+5xPNSExfOht+JNiYIsihy"`
     body@140: `((storageKey, restoreKey) => { if (!window.history.state || !window.history.state.key) { let key = Math.random().toString(32).slice(2); wind`
     carries THIS response's CSP nonce (undefined): yes
  5. attrs: `nonce="yH+5xPNSExfOht+JNiYIsihy"`
     body@140: `window.__reactRouterContext = {"basename":"/","future":{"unstable_enableNodeReadableStream":false,"unstable_optimizeDeps":false},"routeDisco`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
  6. attrs: `nonce="yH+5xPNSExfOht+JNiYIsihy" type="module" async=""`
     body@140: `; import * as route0 from "/assets/root-C-6D5TIZ.js"; import * as route1 from "/assets/search-CMcb3RTH.js"; window.__reactRouterManifest = {`
     carries THIS response's CSP nonce (undefined): yes
  7. attrs: `nonce="yH+5xPNSExfOht+JNiYIsihy"`
     body@140: `window.__reactRouterContext.streamController.enqueue("[{\"_1\":2,\"_3\":-5,\"_4\":-5},\"loaderData\",{\"_5\":6,\"_7\":8},\"actionData\",\"er`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
  8. attrs: `nonce="yH+5xPNSExfOht+JNiYIsihy"`
     body@140: `window.__reactRouterContext.streamController.enqueue("P26:[{\"_154\":680,\"_24\":-5},{\"_62\":63,\"_10\":54,\"_64\":65,\"_66\":67,\"_68\":69`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
  9. attrs: `nonce="yH+5xPNSExfOht+JNiYIsihy"`
     body@140: `window.__reactRouterContext.streamController.close();`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
  10. attrs: `id="_R_"`
     body@140: `requestAnimationFrame(function(){$RT=performance.now()});`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← react-dom/react-router runtime-class script
  11. attrs: ``
     body@140: `$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← react-dom/react-router runtime-class script
- JSON-LD (application/ld+json) present: yes; carries nonce: **no**; declares https://schema.org @context: yes

## Screenshot

- `.fleet/sweep-3301/screenshots/c-mobile.png` (final settled state, viewport)
