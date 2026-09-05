# MagicBrief migration: what the competitor import actually moves

This guide is the executable promise for moving from MagicBrief to Five to Nine. It documents the generic competitor-list import that already ships in the product, reports exactly what is rejected or unsupported without silent loss, and gives a truthful manual fallback. No full MagicBrief export contract is verified, and none is claimed here.

Implementation reference: `app/lib/competitor-import.ts` (parser), `app/lib/setup-checklist-action.server.ts` (preview/create flow), and the public migration page `app/routes/compare.magicbrief.tsx`.

## Supported input

The Market Desk setup import accepts these forms (paste box and `.csv` / `.txt` file upload, combined if both are used):

1. **Pasted lines, one competitor per line** — a domain (`auroraactivewear.com`), a full URL (`https://bluepeakfoods.com/shop`), or a brand name (`Northwind Trail`).
2. **CSV rows with recognized headers.** Every other column is captured as rejected in the preview data contract (`preview.rejectedColumns`) — nothing is silently discarded:

| Field | Accepted header names | What happens to it |
| --- | --- | --- |
| Name | `name`, `company`, `brand`, `competitor`, `advertiser` | Becomes the watchlist label shown in alerts and briefs |
| Website | `domain`, `website`, `url`, `site` | Becomes the tracked target, normalized to a canonical `https://` URL (`www.` stripped) used for Meta ads monitoring |
| Notes | `note`, `notes`, `description` | Saved as import context on the watchlist (workspace memory) |
| Tags | `tag`, `tags` | Saved as import context on the watchlist (semicolon- or comma-separated, up to 10 per row) |
| Client | `client`, `account`, `customer` | Groups the competitor under a client room for client-ready reports, on plans with client reporting |

3. **CSV rows without a recognized header** are mapped positionally: name, website, notes, tags, client. Extra columns beyond those five are not imported; the parser retains the full row text in the preview data (`row.raw`), and you should keep your original file.

Every row scans in the visitor's geo country, and import limits (200 KB, 250 rows, plan watchlist cap) are enforced before anything is written.

## Rejected — reported, never silently lost

- **Unknown CSV columns** are reported through the parser/preview data contract as `preview.rejectedColumns` — for the illustrative fixture below those are `board`, `analytics_impressions`, `analytics_spend`, and `report_date` — and the preview panel lists them ("Columns not imported") while the parser keeps each row's full text in `row.raw`. Keep your original source file as the proof-safe record of what the import did not carry.
- **Invalid rows** (for example a URL with embedded credentials, or a row that looks like it contains a secret) and **duplicate rows** are flagged with a reason in the preview — they are never silently dropped, and nothing is written until you select rows.
- **Rows over the plan's watchlist cap** are marked "over plan" in the preview rather than vanishing.
- Secret-looking notes, tags, or client labels are rejected before anything is written.

## Not imported — what MagicBrief data does not transfer

- **MagicBrief analytics/report history** — spend, impressions, reach, charts, and report dates — is **not imported**. Keep the original export and recreate any numbers you need in your own reports.
- **MagicBrief collections and boards** — saved ad libraries, boards, and saved creative evidence (screenshots, saved ads, links) — are not portable through the generic competitor import. Five to Nine does not migrate them.
- **Historical screenshot/evidence preservation** from MagicBrief does not exist in the generic importer. Going forward, watchlist scans save page text and links as evidence inside Five to Nine, plus a screenshot when the capture includes one.
- **No full MagicBrief export contract is verified.** MagicBrief has announced wind-down with partial export options: per its public FAQ, analytics reports can export CSV while other saved work may require manual recreation. Verify current export options at magicbrief.com, since that surface is not under our control. Until a real export fixture is supplied, full-field-parity migration is not claimed.

## Manual fallback

1. Export whatever MagicBrief currently offers, or just list the brands you tracked.
2. Build a competitor list: one domain, URL, or brand name per line — or a CSV with the recognized headers above.
3. Paste or upload it into the Market Desk setup import and preview it — the preview shows row-level statuses plus any rejected columns (`preview.rejectedColumns` is the parser/preview data contract); keep your original file as the proof-safe record. Then create the watchlists.
4. Recreate anything the import does not carry — notes, tags, collections/boards, and historical evidence — inside Five to Nine, and keep your original export as the source.
5. Need help? Email the support address shown on the public migration page (`/compare/magicbrief`) and we'll move it with you, person to person.

## Illustrative sanitized fixture

The fixture below is an illustrative generic competitor list with analytics/report columns. It is not a real MagicBrief export, and it contains no customer data:

```csv
name,website,notes,tags,client,board,analytics_impressions,analytics_spend,report_date
"Aurora Activewear",auroraactivewear.com,"Spring launch tracking",sportswear; athleisure,Client A,Brand Board,2048,9.99,2026-07-15
Blue Peak Foods,bluepeakfoods.com,Frozen line refresh,packaging,Client B,Product Board,,,
```

Five to Nine maps `name`, `website`, `notes`, `tags`, and `client`; the parser/preview data contract returns `preview.rejectedColumns` as `board`, `analytics_impressions`, `analytics_spend`, and `report_date`, the preview panel lists them as "Columns not imported", and the parser retains each row's full text in `row.raw`. That behavior is proven deterministically by `tests/magicbrief-migration.test.ts` against the real parser.
