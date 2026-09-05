# MagicBrief migration: what actually transfers

Status: **generic competitor-list import, verified against the live importer.**
Date: 2026-08-06.

This guide states exactly what the Five to Nine import accepts and preserves today,
what it rejects, and what must be recreated by hand. It does not claim a full
MagicBrief migration: no MagicBrief export format has been verified against a real
export fixture, and nothing in this document relies on one.

Related: the public migration promise on [`/compare/magicbrief`](../../app/routes/compare.magicbrief.tsx)
and the product decision to "treat MagicBrief migration as generic competitor-list
import unless a real export format is supplied" in
[`docs/market-desk-first-value-progress.md`](./market-desk-first-value-progress.md).

---

## 1. Supported input forms

The importer lives in `app/lib/competitor-import.ts` and is exercised through the
"Add several competitors by paste or CSV" step on the onboarding setup checklist
(`app/components/setup-checklist-card.tsx`). Both the paste box and the uploaded
`.csv`/`.txt` file are accepted; the two are merged into one import.

| Form | Example | How it parses |
| --- | --- | --- |
| One competitor per line (paste or text file) | `nykaa.com` / `https://boat-lifestyle.com` / `Boat Lifestyle` / `Example Brand, brand.com` | Each line yields one competitor. A URL or domain is extracted as the website; the rest of the line is the name. |
| CSV with a recognized header row | `name,domain,notes,tags,client` | Columns are mapped by header name (see table below). Any recognized header switches the whole file to header mode. |
| CSV without a header (positional) | `Example Brand,https://example.com,Watch offers,audio; sale,Client A` | Used when at least one row has 3+ columns and no recognized header is present. Columns map positionally: name, website, notes, tags, client. |

Limits: **250 rows** per import and **200 KB** per paste or upload, checked before
any row is created. Inputs beyond either limit are rejected with an explicit message.

Two caveats that follow from the parser, not from this document:

- A first cell that matches a known header word (for example `Brand`, `Name`, or
  `Competitor`) makes that row the header, so a headerless list must not start with
  one of those words as a company name.
- A two-column list without a recognized header (`Example Brand, brand.com`) is
  parsed by the line reader, not positionally: the domain is still extracted as the
  website and the rest becomes the name.

### Recognized CSV headers

| Field | Accepted header words | Where it lands |
| --- | --- | --- |
| Name | `name`, `company`, `brand`, `competitor`, `advertiser` | Watchlist label (`Example watch`) |
| Website | `domain`, `website`, `url`, `site` | Watchlist target: normalized URL (`https://example.com`) |
| Notes | `note`, `notes`, `description` | Competitor context memory (notes) |
| Tags | `tag`, `tags` | Competitor context memory (tags, split on `,` `;` `\|`, max 10) |
| Client | `client`, `account`, `customer` | Client room (`{client} watch`) with the watchlist linked, on plans with client reports |

Header words are matched after lowercasing and collapsing non-alphanumerics to
underscores, so `ADVERTISER`, `Client Name`-style variants, etc. are not special
beyond that normalization.

## 2. Current import mapping

For every valid row, the importer:

1. Normalizes the website to a canonical URL (`https://` form; `www`/apex variants
   collapse to one fingerprint).
2. Creates a **watchlist** for the competitor — one per row that is selected in the
   preview and fits the plan.
3. Persists **notes** and **tags** as competitor-scoped context memory on that
   watchlist (source `market_desk_import`).
4. Creates or links a **client room** for the client column, when the workspace's
   plan includes client reports.
5. Queues the first scan immediately after creation, so screenshots and page-text
   evidence start being collected for the imported competitor right away.

A plain name with no website becomes a name-based advertiser watchlist (tracked by
search term rather than a site URL). The scan country defaults to the visitor's geo.

## 3. Row dispositions: nothing is silently dropped

Every row is classified in the preview with a visible reason; rows are never
quietly discarded. Only rows marked **valid** and selected are created.

| Disposition | Shown in the preview as | Example reason |
| --- | --- | --- |
| `valid` | Selected / Ready | "Ready to track as a website competitor." |
| `invalid` | Needs edit | "This row looks like it contains a secret or private link. Remove it before importing." / "Enter the website domain only, like brand.com." |
| `duplicate` | Duplicate | "Duplicate of row 1." |
| `existing` | Already tracked | "Already tracked in this workspace." |
| `over_cap` | Over plan | "Over the current plan limit. Select fewer competitors or upgrade." |

The plan limit is re-checked at write time, and any row that no longer fits is
reported to the customer with its row number rather than dropped. Rows that look
like secrets or private links are rejected outright — never imported.

## 4. Unsupported MagicBrief data: not imported, keep your copy

The importer only knows the five fields above. Anything else in a pasted or
uploaded file — including anything from a MagicBrief-style export — is **not
imported**. There is no verified MagicBrief export contract, and this product has
not been tested against a real MagicBrief export file. Do not send customer data
anywhere on the strength of this guide; keep your own copy of the original file.
The sanitized fixture in `tests/magicbrief-migration.test.ts` exercises exactly
this with the columns `advertiser,domain,collection,ad_id,impressions,reach,spend,start_date`.

| MagicBrief data | Disposition | You keep / recreate |
| --- | --- | --- |
| Analytics / report history — impressions, reach, spend, dates, ad IDs, and similar report columns | **Not imported.** Columns outside the recognized set are ignored by the parser. | Retain your export file; re-enter by hand or in your own records. |
| Saved ads, creatives, and screenshots (MagicBrief saved work, Inspire collections) | **Not imported.** There is no file/asset import path. | Keep your downloads. Five to Nine collects fresh screenshots and page-text evidence from its own scans after a watchlist is created. |
| Collections / boards and their membership | **Not imported.** The import creates watchlists (and client rooms), not collections. | Recreate collections by hand after import; then attach the watchlists/saved ads inside Five to Nine. |
| MagicBrief notes and tags on saved work | **Not imported.** MagicBrief's own metadata is not imported; notes/tags in a CSV column are imported as Five to Nine competitor-context memory, which is a different data model. | Recreate any MagicBrief-specific annotations you need. |
| Export formats other than plain CSV/text rows (for example nested or JSON reports) | **Not supported** by the parser. | Convert to the generic forms in section 1, or keep the original file. |
| Ad-account credentials, API keys, private links | **Rejected.** Rows that look like secrets are refused with a reason. | Never include them in an import. |

If a real MagicBrief export fixture is ever supplied, this guide and its tests must
be re-verified against it before any broader migration claim is made.

## 5. Manual recreation fallback

For anything not imported:

1. Keep the original MagicBrief export or screenshots on your own storage.
2. Import your competitor list through one of the supported forms in section 1.
3. Recreate collections and client grouping in the app after the import.
4. Let Five to Nine's scheduled scans build the new screenshot and page-text
   evidence; the old evidence never transfers.

## 6. Verification

The claims in this guide are locked to the real parser by
`tests/magicbrief-migration.test.ts`, which runs sanitized fixtures through
`buildCompetitorImportPreview` and asserts:

- each supported input form maps fields exactly as section 2 describes,
- unsupported columns (the rejected-field report in section 4) are not imported,
- invalid, duplicate, and over-limit rows surface with reasons rather than being
  dropped,
- the fixtures and guide contain no secrets or personal data.

Run it with:

```
npx vitest run tests/magicbrief-migration.test.ts tests/competitor-import.test.ts
```
