# Chrome Web Store listing (paste-ready)

Prepared from a load-unpacked run of `extension/`. Paste these fields into the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
Store listing and Privacy tabs. Do not create the developer account, pay the
$5 fee, or submit from an agent session.

Sources: `extension/manifest.json`, `extension/README.md` (permissions and the
honest listing draft), and Chrome's listing / image rules
([listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/),
[images](https://developer.chrome.com/docs/webstore/images/),
[privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/),
[manifest description](https://developer.chrome.com/docs/extensions/reference/manifest)
132-character short description, 75-character name).

## Store listing tab

**Name** (manifest `name`, max 75 characters):

```
Five to Nine — Competitor Ads
```

**Short description** (manifest `description`, max 132 characters):

```
See any brand's Meta ads. One click from their website.
```

**Full description** (Store listing detailed description). Start with what it
does, then the permission and privacy facts, matching the README:

```
Five to Nine shows you any brand's Meta ads while you're on their website. Click the icon and you get one-click paths into Five to Nine (0509.io): the brand's ad page, a live Meta Ad Library search for their site, or a watchlist so you're alerted when their ads change. If the current tab has no usable address, type any domain instead.

The extension uses only the activeTab permission to read the current tab's URL when you open it. It handles that URL locally, extracts the domain, and sends the domain to 0509.io only when you choose a destination. It does not read page content or broader browsing history, persist the URL or domain, run analytics, or load remote code. Viewing ads, live searches, and watchlists run on 0509.io; searches work without an account, while watchlists require one. Privacy policy: https://0509.io/privacy
```

**Category:** Productivity

**Language:** English

**Homepage URL:** `https://0509.io`

**Privacy policy URL:** `https://0509.io/privacy`

## Graphic assets

| Asset | File | Size | Notes |
|---|---|---|---|
| Store icon | `extension/icons/icon-128.png` | 128×128 PNG | Already in the extension zip. |
| Screenshot 1 (required) | `extension/store/screenshot-popup-on-brand.png` | 1280×800 PNG | Popup open on nike.com after Load unpacked. Shows the domain-from-tab view. |
| Screenshot 2 | `extension/store/screenshot-popup-fallback.png` | 1280×800 PNG | Popup open on a new tab. Shows the type-a-domain fallback. |

Screenshots are square-corner, full-bleed 1280×800 as required by
[Supplying Images](https://developer.chrome.com/docs/webstore/images/). Upload
them on the Store listing tab. They are listing assets, not part of the
extension zip.

Small promo tile 440×280 and marquee 1400×560 are optional. Skip them unless
the dashboard blocks submit without the small tile.

## Privacy tab

**Single purpose:**

```
Show the current website's Meta ads and provide user-chosen paths into Five to Nine search and watchlist flows.
```

**Permission justification (`activeTab` only):**

```
activeTab reads the active tab's URL after the user opens the extension so it can extract the website domain. It does not read page content or broader browsing history.
```

That is the same justification as the README permissions section: `activeTab`
is granted just-in-time when the user clicks the icon, and it is used solely
to read the active tab's URL so the popup can extract the domain. No `tabs` permission, no host permissions, no content scripts.

**Data usage:** declare **Web browsing activity**. The extension accesses the
current tab's URL only when the user opens it, handles the URL locally, and
extracts its domain. The domain is sent to 0509.io only after the user chooses
an action. A manually entered domain is handled the same way.

**Storage, logging, and sharing:** the extension does not persist the URL or
domain. Five to Nine and service providers needed to operate the chosen action
process the destination request, which may appear in operational logs. The
data is not sold or used for advertising, profiling, or creditworthiness.

**Remote code:** No. The extension does not load or execute remote code.

**Limited Use:** certify that Chrome API data is used only for the extension's
disclosed single purpose and complies with the Chrome Web Store User Data
Policy, including the Limited Use requirements.

**Privacy policy URL:** `https://0509.io/privacy`

## Zip at submit time (owner)

Zip the *contents* of `extension/` with `manifest.json` at the zip root.
Exclude `README.md`, `scripts/`, `icons/icon.svg`, and this `store/` directory
(Chrome ignores extra files, but listing screenshots do not belong in the
package). Include `manifest.json`, `popup.html`, `popup.css`, `popup.js`,
`lib/`, and `icons/icon-*.png`.

## Remaining owner steps (money)

1. Register a Chrome Web Store developer account.
2. Pay the one-time $5 developer fee.
3. Submit: upload the zip, paste the fields above, upload the two screenshots,
   fill the Privacy tab, then publish.

Do not create the account, pay, or submit from an agent session.
