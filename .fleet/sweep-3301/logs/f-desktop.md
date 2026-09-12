# Journey f — desktop (desktop 1440×900)

- Journey: (f) signup start — /signup (302) landing on /auth/signup (initial navigation: `/signup`)
- Base URL: `https://0509.io` (E2E_PROD_BASE_URL; production, pre-fix at sweep time)
- Context: `...devices["Desktop Chrome"]` + viewport 1440×900 — exactly the playwright.config.ts `chromium` project's use block; headless; deviceScaleFactor 1; UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Safari/537.36`
- Process: single sequential node/playwright process, no worker pool (PLAYWRIGHT_WORKERS=1 honored); no retries.
- Started: 2026-09-12T23:46:34.311Z — Finished: 2026-09-12T23:46:38.141Z (duration 3.8s)
- **Final URL: https://0509.io/auth/signup**
- Main-frame navigation response chain (final response, walked backwards through redirect hops):

1. 200 → https://0509.io/auth/signup
2. 302 → https://0509.io/signup (Location: /auth/signup)

## Counts (unbounded — every record below is complete, nothing truncated)

- console records: 0 total (error: 0, warning: 0, other: 0)
- securitypolicyviolation events: 0
- pageerror events: 0
- failed requests: 0
- document-type responses seen: 2
- journey completed without vehicle error

## ALL console messages (full text)

_none._

## securitypolicyviolation events (ALL fields)

_none._

## pageerror events (full text + stack)

_none._

## document-type responses (all, incl. iframes; Location = redirect hop)

1. 302 https://0509.io/signup (Location: /auth/signup) — frame: about:blank
2. 200 https://0509.io/auth/signup — frame: about:blank

## failed requests (all)

_none._

## Raw-HTML inline-script inventory of the FINAL URL (this response's own CSP nonce)

- raw fetch: 200 https://0509.io/auth/signup
- Content-Security-Policy (full): `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-fKYgxpoyx19coHbcfQgwiT4+'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
- script-src directive: `script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-fKYgxpoyx19coHbcfQgwiT4+'`
- nonce tokens in policy: 1; 'unsafe-inline' present: false; 'sha256-' hashes present: false
- ALL <script> tags: 8; src-less (inline) of those: 8
- per src-less (inline) script: attrs + first 140 chars of body + nonce verdict
  1. attrs: `nonce="fKYgxpoyx19coHbcfQgwiT4+"`
     body@140: `(function(){try{var s=null;try{s=localStorage.getItem("f9-theme")}catch(e){}var d=s==="dark"||(s!=="light"&&window.matchMedia&&window.matchM`
     carries THIS response's CSP nonce (undefined): yes
  2. attrs: `nonce="fKYgxpoyx19coHbcfQgwiT4+"`
     body@140: `(function(){try{var l=document.getElementById("f9-font-stylesheet");if(!l)return;function apply(){l.media="all";}if(l.addEventListener){l.ad`
     carries THIS response's CSP nonce (undefined): yes
  3. attrs: `type="application/ld+json"`
     body@140: `{"@context":"https://schema.org","@type":"WebPage","@id":"https://0509.io/auth/signup","url":"https://0509.io/auth/signup","name":"Create ac`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← application/ld+json
  4. attrs: `nonce="fKYgxpoyx19coHbcfQgwiT4+"`
     body@140: `((storageKey, restoreKey) => { if (!window.history.state || !window.history.state.key) { let key = Math.random().toString(32).slice(2); wind`
     carries THIS response's CSP nonce (undefined): yes
  5. attrs: `nonce="fKYgxpoyx19coHbcfQgwiT4+"`
     body@140: `window.__reactRouterContext = {"basename":"/","future":{"unstable_enableNodeReadableStream":false,"unstable_optimizeDeps":false},"routeDisco`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
  6. attrs: `nonce="fKYgxpoyx19coHbcfQgwiT4+" type="module" async=""`
     body@140: `; import * as route0 from "/assets/root-C-6D5TIZ.js"; import * as route1 from "/assets/auth.signup-nj8UAlZr.js"; window.__reactRouterManifes`
     carries THIS response's CSP nonce (undefined): yes
  7. attrs: `nonce="fKYgxpoyx19coHbcfQgwiT4+"`
     body@140: `window.__reactRouterContext.streamController.enqueue("[{\"_1\":2,\"_3\":-5,\"_4\":-5},\"loaderData\",{\"_5\":6,\"_7\":8},\"actionData\",\"er`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
  8. attrs: `nonce="fKYgxpoyx19coHbcfQgwiT4+"`
     body@140: `window.__reactRouterContext.streamController.close();`
     carries THIS response's CSP nonce (undefined): yes  ← react-dom/react-router runtime-class script
- JSON-LD (application/ld+json) present: yes; carries nonce: **no**; declares https://schema.org @context: yes

## Screenshot

- `.fleet/sweep-3301/screenshots/f-desktop.png` (final settled state, viewport)
