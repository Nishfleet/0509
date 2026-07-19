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
- **Sends nothing anywhere.** No analytics, no remote code, no background
  network requests. The extension's only "network" behavior is opening
  0509.io in a new tab when you press a button.

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

Submission happens via the [Chrome Web Store Developer Dashboard]
(https://chrome.google.com/webstore/devconsole) — one-time $5 developer fee
if the account isn't registered yet.

1. **Zip the package:** zip the *contents* of `extension/` (manifest at zip
   root). Exclude `README.md`, `scripts/`, and `icons/icon.svg` if you want a
   minimal package (they're harmless to include; Chrome ignores them).
2. **Listing assets to prepare:**
   - Store icon 128×128 PNG — use `icons/icon-128.png`.
   - At least one screenshot, 1280×800 (or 640×400): popup open on a
     well-known brand's site; a second one showing the fallback form is nice.
   - Optional small promo tile 440×280 (bone ground, wordmark + clock mark).
3. **Listing copy (honest draft, edit freely):**

   > Five to Nine shows you any brand's Meta ads while you're on their
   > website. Click the icon and you get one-click paths into Five to Nine
   > (0509.io): the brand's ad page, a live Meta Ad Library search for their
   > site, or a watchlist so you're alerted when their ads change. If the
   > current tab has no usable address, type any domain instead.
   >
   > The extension itself collects nothing. It uses only the activeTab
   > permission to read the current tab's domain at the moment you click —
   > no content scripts, no browsing history, no analytics, no remote code.
   > Viewing ads, live searches, and watchlists run on 0509.io; searches
   > work without an account, watchlists require one.

4. **Privacy tab in the dashboard:** declare "no user data collected";
   single purpose = "show the current site's Meta ads via Five to Nine";
   justify `activeTab` = "read the active tab's URL to extract the brand
   domain when the user clicks the action".
5. **Verify the `/ads/{domain}` route is live in production** (it ships from
   the public-brand-pages track) before submitting, so the primary button
   never 404s for reviewers.
6. Category: Productivity (or Developer Tools). Language: English.
