# Five to Nine — Competitor Ads (Chrome extension)

While you're on any brand's website, one click shows you their Meta ads via
[Five to Nine](https://0509.io). The popup reads the active tab's domain and
offers three actions:

- **See their Meta ads** → `https://0509.io/ads/{domain}` (public brand page)
- **Run a live search** → `https://0509.io/search?website=https://{domain}`
- **Watch this competitor** → sign-up with a redirect into onboarding,
  prefilled with the domain

On pages without a normal website address (`chrome://`, `file://`, new tab,
PDFs), the popup falls back to a small form where you type any brand's domain
and get the same three actions.

## Load unpacked (development / pre-store use)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` directory.
4. Pin "Five to Nine — Competitor Ads" from the puzzle-piece menu, browse to
   any brand's site, and click the icon.

No build step. The directory is loadable as-is (icons are pre-rendered PNGs,
checked in).

## Permissions and privacy

- **`activeTab` only.** Granted just-in-time when you click the extension
  icon; used solely to read the active tab's URL so the popup can extract the
  domain. No `tabs` permission, no host permissions, no content scripts.
- **Reads nothing from the page.** Not the DOM, not cookies, not history —
  only the URL of the tab you clicked on, only at the moment you click.
- **No background collection.** The extension has no analytics, remote code,
  or background network requests. The current URL is handled locally and
  reduced to a domain. When you choose an action, the extension opens a
  0509.io URL containing that domain, so the domain is sent to Five to Nine as
  part of the browser request. The extension does not persist the URL or
  domain. See the [Five to Nine privacy policy](https://0509.io/privacy).

## Architecture

```
extension/
  manifest.json          MV3, action popup, activeTab
  popup.html/.css/.js    the popup (hand-written, no frameworks)
  lib/domain.mjs         pure domain-normalization + URL building
  icons/icon.svg         source motif (clock reading 05:09)
  icons/icon-*.png       rendered icons (16/32/48/128), committed
  scripts/render-icons.mjs  regenerates the PNGs — zero-dependency
                            procedural renderer (node:zlib only)
  store/listing.md       paste-ready Chrome Web Store fields
  store/*.png            1280×800 listing screenshots (not in the zip)
```

`extension/` is deliberately outside the app build: it is not referenced by
`vite.config.ts`, `react-router.config.ts`, any tsconfig project, or
`wrangler.jsonc`. `tests/extension-domain.test.ts` in the app's vitest suite
covers `lib/domain.mjs` without entangling the extension in the app's
TypeScript projects.

Chrome's manifest does **not** accept SVG for `icons`/`default_icon`, so the
PNGs are required and committed. To regenerate after changing the motif
(keep `icon.svg` and the geometry in `render-icons.mjs` in sync):

```bash
node extension/scripts/render-icons.mjs
```

## Store submission checklist (owner)

Paste-ready fields and screenshots live in [`store/listing.md`](store/listing.md).
Submission happens via the [Chrome Web Store Developer Dashboard]
(https://chrome.google.com/webstore/devconsole). Remaining owner steps are
only the developer account, the one-time $5 fee, and submit. Do not create the account, pay, or submit from an agent session.

- [ ] **Zip the package at submit time:** zip the *contents* of `extension/`
  (manifest at zip root). Exclude `README.md`, `scripts/`, `icons/icon.svg`,
  and `store/` (listing screenshots are dashboard uploads, not package files).
- [x] **Listing assets:**
  - Store icon 128×128 PNG — `icons/icon-128.png`.
  - Screenshot 1280×800: popup open on nike.com after Load unpacked —
    `store/screenshot-popup-on-brand.png`.
  - Second screenshot 1280×800: fallback form on a new tab —
    `store/screenshot-popup-fallback.png`.
  - Optional small promo tile 440×280 skipped (dashboard does not require it
    to prepare the bundle).
- [x] **Listing copy** (canonical paste in `store/listing.md`):

   > Five to Nine shows you any brand's Meta ads while you're on their
   > website. Click the icon and you get one-click paths into Five to Nine
   > (0509.io): the brand's ad page, a live Meta Ad Library search for their
   > site, or a watchlist so you're alerted when their ads change. If the
   > current tab has no usable address, type any domain instead.
   >
   > The extension uses only the activeTab permission to read the current
   > tab's URL when you open it. It handles that URL locally, extracts the
   > domain, and sends the domain to 0509.io only when you choose a destination.
   > It does not read page content or broader browsing history, persist the URL
   > or domain, run analytics, or load remote code. Viewing ads, live searches,
   > and watchlists run on 0509.io; searches work without an account, while
   > watchlists require one. Privacy policy: https://0509.io/privacy

- [x] **Privacy tab answers** (canonical paste in `store/listing.md`):
  - **Single purpose:** "Show the current website's Meta ads and provide
    user-chosen paths into Five to Nine search and watchlist flows."
  - **Data usage:** declare **Web browsing activity**. The extension accesses
    the current tab's URL only when the user opens it, handles the URL locally,
    and extracts its domain. The domain is sent to 0509.io only after the user
    chooses an action. A manually entered domain is handled the same way.
  - **Storage, logging, and sharing:** the extension does not persist the URL
    or domain. Five to Nine and service providers needed to operate the chosen
    action process the destination request, which may appear in operational
    logs. The data is not sold or used for advertising, profiling, or
    creditworthiness.
  - **Permission justification:** "activeTab reads the active tab's URL after
    the user opens the extension so it can extract the website domain. It does
    not read page content or broader browsing history."
  - **Limited Use:** certify that Chrome API data is used only for the
    extension's disclosed single purpose and complies with the Chrome Web
    Store User Data Policy, including the Limited Use requirements.
  - **Privacy policy URL:** `https://0509.io/privacy`.
- [x] **`/ads/{domain}` is live in production** (`https://0509.io/ads/nike.com`
  returned HTTP 200 on 2026-09-09), so the primary button will not 404 for
  reviewers.
- [x] **Category and language:** Productivity. English.

Remaining owner steps (money; do not do these from an agent session):

- [ ] Register the Chrome Web Store developer account.
- [ ] Pay the one-time $5 developer fee.
- [ ] Submit: upload the zip, paste `store/listing.md`, upload the two
  screenshots, fill the Privacy tab, then publish.
