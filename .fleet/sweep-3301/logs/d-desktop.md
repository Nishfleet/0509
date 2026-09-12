# Journey d — desktop (desktop 1440×900)

- Journey: (d) /pricing (initial navigation: `/pricing`)
- Base URL: `https://0509.io` (E2E_PROD_BASE_URL; production, pre-fix at sweep time)
- Context: `...devices["Desktop Chrome"]` + viewport 1440×900 — exactly the playwright.config.ts `chromium` project's use block; headless; deviceScaleFactor 1; UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Safari/537.36`
- Process: single sequential node/playwright process, no worker pool (PLAYWRIGHT_WORKERS=1 honored); no retries.
- Started: 2026-09-12T23:46:26.429Z — Finished: 2026-09-12T23:46:30.053Z (duration 3.6s)
- **Final URL: https://0509.io/pricing**
- Main-frame navigation response chain (final response, walked backwards through redirect hops):

1. 200 → https://0509.io/pricing

## Counts (unbounded — every record below is complete, nothing truncated)

- console records: 0 total (error: 0, warning: 0, other: 0)
- securitypolicyviolation events: 0
- pageerror events: 0
- failed requests: 0
- document-type responses seen: 1
- journey completed without vehicle error

## ALL console messages (full text)

_none._

## securitypolicyviolation events (ALL fields)

_none._

## pageerror events (full text + stack)

_none._

## document-type responses (all, incl. iframes; Location = redirect hop)

1. 200 https://0509.io/pricing — frame: about:blank

## failed requests (all)

_none._

## Raw-HTML inline-script inventory of the FINAL URL (this response's own CSP nonce)

- raw fetch: 200 https://0509.io/pricing
- Content-Security-Policy (full): `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'sha256-aArfOxtKReCKujujKHr47gNYn7jQaP06FVwNI51OVJA=' 'sha256-1cWVmiiz1FFvQ8DIdfO9FZDWYRKUo30gbZcJYNyA9QY=' 'sha256-n1D9cZXw4ZNSiUR+6/8u4KC6Mx7KCFb9ScJA8U0UdhI=' 'sha256-sZHM2xe/enhd5U5YF1eTHxxOENdnvwB8wDQVOGWNJZY=' 'sha256-FSrPgymDSF4Xatjq+eXws5yILdkZwEAY+grE9XA6WgQ=' 'sha256-KUx6qHNcRzmGwofNiCtYBGCQ2XG1LgWzFH39YZy8tEY=' 'sha256-RBZNiG3Ztb26Xi/69+VRecU4BPhrfxcvspLXMRrrCNE='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
- script-src directive: `script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'sha256-aArfOxtKReCKujujKHr47gNYn7jQaP06FVwNI51OVJA=' 'sha256-1cWVmiiz1FFvQ8DIdfO9FZDWYRKUo30gbZcJYNyA9QY=' 'sha256-n1D9cZXw4ZNSiUR+6/8u4KC6Mx7KCFb9ScJA8U0UdhI=' 'sha256-sZHM2xe/enhd5U5YF1eTHxxOENdnvwB8wDQVOGWNJZY=' 'sha256-FSrPgymDSF4Xatjq+eXws5yILdkZwEAY+grE9XA6WgQ=' 'sha256-KUx6qHNcRzmGwofNiCtYBGCQ2XG1LgWzFH39YZy8tEY=' 'sha256-RBZNiG3Ztb26Xi/69+VRecU4BPhrfxcvspLXMRrrCNE='`
- nonce tokens in policy: 0; 'unsafe-inline' present: false; 'sha256-' hashes present: true
- ALL <script> tags: 11; src-less (inline) of those: 11
- per src-less (inline) script: attrs + first 140 chars of body + nonce verdict
  1. attrs: `nonce="b+wwPtZMGZs6hkuWMJ2LAkny"`
     body@140: `(function(){try{var s=null;try{s=localStorage.getItem("f9-theme")}catch(e){}var d=s==="dark"||(s!=="light"&&window.matchMedia&&window.matchM`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**
  2. attrs: `nonce="b+wwPtZMGZs6hkuWMJ2LAkny"`
     body@140: `(function(){try{var l=document.getElementById("f9-font-stylesheet");if(!l)return;function apply(){l.media="all";}if(l.addEventListener){l.ad`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**
  3. attrs: `type="application/ld+json"`
     body@140: `{"@context":"https://schema.org","@type":"WebPage","@id":"https://0509.io/pricing","url":"https://0509.io/pricing","name":"Pricing | Five to`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← application/ld+json
  4. attrs: `type="application/ld+json"`
     body@140: `{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What uses proof captures?","acceptedAnswer":{"@`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← application/ld+json
  5. attrs: `type="application/ld+json"`
     body@140: `{"@context":"https://schema.org","@graph":[{"@context":"https://schema.org","@type":"Product","name":"Free","description":"Free Five to Nine`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← application/ld+json
  6. attrs: `type="application/ld+json"`
     body@140: `{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← application/ld+json
  7. attrs: `nonce="b+wwPtZMGZs6hkuWMJ2LAkny"`
     body@140: `((storageKey, restoreKey) => { if (!window.history.state || !window.history.state.key) { let key = Math.random().toString(32).slice(2); wind`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**
  8. attrs: `nonce="b+wwPtZMGZs6hkuWMJ2LAkny"`
     body@140: `window.__reactRouterContext = {"basename":"/","future":{"unstable_enableNodeReadableStream":false,"unstable_optimizeDeps":false},"routeDisco`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← react-dom/react-router runtime-class script
  9. attrs: `nonce="b+wwPtZMGZs6hkuWMJ2LAkny" type="module" async=""`
     body@140: `; import * as route0 from "/assets/root-C-6D5TIZ.js"; import * as route1 from "/assets/pricing-ChY0vQt6.js"; window.__reactRouterManifest = `
     carries THIS response's CSP nonce (undefined): **NO — nonceless**
  10. attrs: `nonce="b+wwPtZMGZs6hkuWMJ2LAkny"`
     body@140: `window.__reactRouterContext.streamController.enqueue("[{\"_1\":2,\"_3\":-5,\"_4\":-5},\"loaderData\",{\"_5\":6,\"_7\":8},\"actionData\",\"er`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← react-dom/react-router runtime-class script
  11. attrs: `nonce="b+wwPtZMGZs6hkuWMJ2LAkny"`
     body@140: `window.__reactRouterContext.streamController.close();`
     carries THIS response's CSP nonce (undefined): **NO — nonceless**  ← react-dom/react-router runtime-class script
- JSON-LD (application/ld+json) present: yes; carries nonce: **no**; declares https://schema.org @context: yes

## Screenshot

- `.fleet/sweep-3301/screenshots/d-desktop.png` (final settled state, viewport)
