# Journey c — desktop (desktop 1440×900)

- Journey: (c) selected proof — populated + click first result row → ?selected= (initial navigation: `/search?q=nike&country=all`)
- Base URL: `https://0509.io` (E2E_PROD_BASE_URL; production, pre-fix at sweep time)
- Context: `...devices["Desktop Chrome"]` + viewport 1440×900 — exactly the playwright.config.ts `chromium` project's use block; headless; deviceScaleFactor 1; UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Safari/537.36`
- Process: single sequential node/playwright process, no worker pool (PLAYWRIGHT_WORKERS=1 honored); no retries.
- Started: 2026-09-12T23:46:07.895Z — Finished: 2026-09-12T23:46:11.710Z (duration 3.8s)
- **Final URL: https://0509.io/search?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376#selected-proof**
- Main-frame navigation response chain (final response, walked backwards through redirect hops):

1. 200 → https://0509.io/search?q=nike&country=all

## Counts (unbounded — every record below is complete, nothing truncated)

- console records: 5 total (error: 5, warning: 0, other: 0)
- securitypolicyviolation events: 5
- pageerror events: 2
- failed requests: 1
- document-type responses seen: 1
- journey completed without vehicle error

## ALL console messages (full text)

1. `[error]` Executing inline script violates the following Content Security Policy directive 'script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-UzmeQfgOcNLBxYFNvCQTX/Bk''. Either the 'unsafe-inline' keyword, a hash ('sha256-7mu4H06fwDCjmnxxr/xNHyuQC6pLTHr4M2E4jXw5WZs='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
   - location: https://0509.io/search?q=nike&country=all:187:0
2. `[error]` Executing inline script violates the following Content Security Policy directive 'script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-UzmeQfgOcNLBxYFNvCQTX/Bk''. Either the 'unsafe-inline' keyword, a hash ('sha256-kyaKBybsHvqmdq5RcfhCZ+crfD0hW2GQeUy0Bp1fWNg='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
   - location: https://0509.io/search?q=nike&country=all:187:0
3. `[error]` Executing inline script violates the following Content Security Policy directive 'script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-UzmeQfgOcNLBxYFNvCQTX/Bk''. Either the 'unsafe-inline' keyword, a hash ('sha256-jxpmuzEyvVmGf1uu3rLnVb++ac4Q0kh49VFIlwUf6Q0='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
   - location: https://0509.io/search?q=nike&country=all:188:0
4. `[error]` Executing inline script violates the following Content Security Policy directive 'script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-UzmeQfgOcNLBxYFNvCQTX/Bk''. Either the 'unsafe-inline' keyword, a hash ('sha256-ot4uWMULOgQERJVeW+1RS4LiQazeh9VYa+IzbwCX43U='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
   - location: https://0509.io/search?q=nike&country=all:188:0
5. `[error]` Executing inline script violates the following Content Security Policy directive 'script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-UzmeQfgOcNLBxYFNvCQTX/Bk''. Either the 'unsafe-inline' keyword, a hash ('sha256-D9S5KXsSSajKKVF3Jf+B22EHGKgFWMmaLff5rY6FNZc='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
   - location: https://0509.io/search?q=nike&country=all:188:0

## securitypolicyviolation events (ALL fields)

1. **script-src-elem** blocked **inline** (disposition enforce, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 188  columnNumber: 0
   - sample: ``
   - originalPolicy: `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-UzmeQfgOcNLBxYFNvCQTX/Bk'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
2. **script-src-elem** blocked **inline** (disposition enforce, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 188  columnNumber: 0
   - sample: ``
   - originalPolicy: `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-UzmeQfgOcNLBxYFNvCQTX/Bk'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
3. **script-src-elem** blocked **inline** (disposition enforce, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 189  columnNumber: 0
   - sample: ``
   - originalPolicy: `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-UzmeQfgOcNLBxYFNvCQTX/Bk'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
4. **script-src-elem** blocked **inline** (disposition enforce, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 189  columnNumber: 0
   - sample: ``
   - originalPolicy: `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-UzmeQfgOcNLBxYFNvCQTX/Bk'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
5. **script-src-elem** blocked **inline** (disposition enforce, statusCode 200)
   - violatedDirective: `script-src-elem`
   - documentURI: `https://0509.io/search?q=nike&country=all`
   - sourceFile: `https://0509.io/search`  lineNumber: 189  columnNumber: 0
   - sample: ``
   - originalPolicy: `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-UzmeQfgOcNLBxYFNvCQTX/Bk'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`

## pageerror events (full text + stack)

1. **Error**: Minified React error #419; visit https://react.dev/errors/419 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.
   - stack: ``
2. **Error**: Minified React error #419; visit https://react.dev/errors/419 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.
   - stack: ``

## document-type responses (all, incl. iframes; Location = redirect hop)

1. 200 https://0509.io/search?q=nike&country=all — frame: about:blank

## failed requests (all)

1. https://0509.io/search.data?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376 — net::ERR_ABORTED (other)

## Raw-HTML inline-script inventory of the FINAL URL (this response's own CSP nonce)

- raw fetch: 200 https://0509.io/search?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376#selected-proof
- Content-Security-Policy (full): `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-o26OlX0QQyggDJPD3YESxDTl'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
- script-src directive: `script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-o26OlX0QQyggDJPD3YESxDTl'`
- nonce tokens in policy: 1; 'unsafe-inline' present: false; 'sha256-' hashes present: false
- ALL <script> tags: 14; src-less (inline) of those: 14
- per src-less (inline) script: attrs + first 140 chars of body + nonce verdict
  1. attrs: `nonce="o26OlX0QQyggDJPD3YESxDTl"`
     body@140: `(function(){try{var s=null;try{s=localStorage.getItem("f9-theme")}catch(e){}var d=s==="dark"||(s!=="light"&&window.matchMedia&&window.matchM`
     carries THIS response's CSP nonce (undefined): yes
  2. attrs: `nonce="o26OlX0QQyggDJPD3YESxDTl"`
     body@140: `(function(){try{var l=document.getElementById("f9-font-stylesheet");if(!l)return;function apply(){l.media="all";}if(l.addEventListener){l.ad`
     carries THIS response's CSP nonce (undefined): yes
  3. attrs: `type="application/ld+json"`
     body@140: `{"@context":"https://schema.org","@type":"WebPage","@id":"https://0509.io/search","url":"https://0509.io/search","name":"Search competitor M`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← application/ld+json
  4. attrs: `nonce="o26OlX0QQyggDJPD3YESxDTl"`
     body@140: `((storageKey, restoreKey) => { if (!window.history.state || !window.history.state.key) { let key = Math.random().toString(32).slice(2); wind`
     carries THIS response's CSP nonce (undefined): yes
  5. attrs: `nonce="o26OlX0QQyggDJPD3YESxDTl"`
     body@140: `window.__reactRouterContext = {"basename":"/","future":{"unstable_enableNodeReadableStream":false,"unstable_optimizeDeps":false},"routeDisco`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
  6. attrs: `nonce="o26OlX0QQyggDJPD3YESxDTl" type="module" async=""`
     body@140: `; import * as route0 from "/assets/root-C-6D5TIZ.js"; import * as route1 from "/assets/search-CMcb3RTH.js"; window.__reactRouterManifest = {`
     carries THIS response's CSP nonce (undefined): yes
  7. attrs: `nonce="o26OlX0QQyggDJPD3YESxDTl"`
     body@140: `window.__reactRouterContext.streamController.enqueue("[{\"_1\":2,\"_3\":-5,\"_4\":-5},\"loaderData\",{\"_5\":6,\"_7\":8},\"actionData\",\"er`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
  8. attrs: `id="_R_"`
     body@140: `requestAnimationFrame(function(){$RT=performance.now()});`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← react-dom/react-router runtime-class script
  9. attrs: ``
     body@140: `$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← react-dom/react-router runtime-class script
  10. attrs: ``
     body@140: `$RC("B:0","S:0")`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← react-dom/react-router runtime-class script
  11. attrs: `nonce="o26OlX0QQyggDJPD3YESxDTl"`
     body@140: `window.__reactRouterContext.streamController.enqueue("P26:[{\"_176\":1151,\"_24\":-5},{\"_62\":63,\"_10\":54,\"_64\":65,\"_66\":67,\"_68\":6`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
  12. attrs: ``
     body@140: `$RC("B:2","S:2")`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← react-dom/react-router runtime-class script
  13. attrs: `nonce="o26OlX0QQyggDJPD3YESxDTl"`
     body@140: `window.__reactRouterContext.streamController.close();`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
  14. attrs: ``
     body@140: `$RC("B:3","S:3")`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← react-dom/react-router runtime-class script
- JSON-LD (application/ld+json) present: yes; carries nonce: **no**; declares https://schema.org @context: yes

## Screenshot

- `.fleet/sweep-3301/screenshots/c-desktop.png` (final settled state, viewport)
