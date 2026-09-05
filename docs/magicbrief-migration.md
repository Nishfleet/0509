# MagicBrief Migration Promise

## Status

0509 does **not** claim full MagicBrief migration. No real MagicBrief export fixture
exists in this repository, and no MagicBrief export contract is verified against the
importer. The only supported path is the existing generic competitor-list import
(paste, or CSV pasted or uploaded), which is documented in this guide exactly as the
code implements it.

The product decision that MagicBrief migration is treated as generic competitor-list
import unless a real export format is supplied is recorded in
`docs/market-desk-first-value-progress.md`.

## Supported input forms

The import preview (`buildCompetitorImportPreview` in
`app/lib/competitor-import.ts`) accepts one of the following:

1. **Pasted lines** — one competitor per line. Each line may be a website
   (`brand.com`, `www.brand.com`, `https://brand.com`), a plain brand name
   (`Brand Name`), or a name plus website on the same line (`Brand Name brand.com`).
2. **CSV with a recognized header row** — the header names accepted columns (see the
   accepted-columns table below); unknown columns are reported, not imported.
3. **CSV without a header row** — columns are positional: `name`, `website`, `notes`,
   `tags`, `client`. A two-column name/website CSV is also readable as pasted
   "name + website" lines.
4. **Uploaded text/CSV file** — same content rules as paste; the file text and the
   pasted text are combined.

Hard limits enforced by the parser: 200 KB of raw input, 250 rows per import, and
the workspace plan's watchlist cap (rows beyond the cap are surfaced with a reason,
never dropped).

## Accepted CSV columns

| CSV column synonyms | Maps to |
| --- | --- |
| `name`, `company`, `brand`, `competitor`, `advertiser` | Brand label |
| `domain`, `website`, `url`, `site` | Competitor website |
| `note`, `notes`, `description` | Notes |
| `tag`, `tags` | Tags |
| `client`, `account`, `customer` | Client grouping |

These exact header synonyms are exported as
`COMPETITOR_IMPORT_ACCEPTED_HEADERS` (with per-field groups
`COMPETITOR_IMPORT_NAME_HEADERS`, `COMPETITOR_IMPORT_WEBSITE_HEADERS`,
`COMPETITOR_IMPORT_NOTES_HEADERS`, `COMPETITOR_IMPORT_TAG_HEADERS`,
`COMPETITOR_IMPORT_CLIENT_HEADERS`) from `app/lib/competitor-import.ts`, and the
fixture tests in `tests/magicbrief-migration.test.ts` prove this guide lists exactly
the headers the parser accepts.

## Current import mapping

| Imported data | What 0509 keeps or does |
| --- | --- |
| Website | Normalized to a canonical `https://` URL plus host; the row becomes a website competitor watchlist targeting the brand. |
| Brand name | Becomes the competitor label. When no name is given, the label is derived from the domain (e.g. `aurorabeauty.example` → `Aurora Beauty`). |
| Notes | Saved as watchlist-scoped context (`import_context` agent memory) so the agent can use them. |
| Tags | Split on `;`, `|`, or `,` (up to 10 tags per row) and saved in the same watchlist-scoped context. |
| Client | Creates or reuses a `{client} watch` client room and links the created watchlist into it. |
| Country | The import country (visitor geo default or the workspace's selected country) is applied to every created target. |

Each created row is an advertiser target with `trackingRole: competitor`.

## Rejected fields — never silently dropped

Anything the parser cannot represent is reported, never silently discarded.

`preview.rejectedFields` is the parser/preview data contract: the import preview
API returns every column it could not represent. The current onboarding UI
exposes row-level statuses (valid, invalid, duplicate, existing, over cap) but
does not yet render a dedicated rejected-column panel. Until it does, keeping the
original source file is the proof-safe path: the contract reports which columns
were rejected, and the source file preserves their values.

- **Unknown CSV columns.** Any header that is not in the accepted-columns table
  above is returned by the preview API in `preview.rejectedFields` (normalized
  header names in first-seen order, deduplicated). Examples of column names that
  are rejected: `spend`, `impressions`, `reach`, `campaign_name`, `collection`,
  `screenshot_url`.
- **Positional overflow.** In a headerless CSV, columns after the fifth
  (`name, website, notes, tags, client`) are reported as `column 6`, `column 7`,
  and so on.
- **Invalid rows.** A row that cannot become a target keeps its row entry with
  `status: "invalid"` and a human-readable reason (for example, a single-character
  name, or a website that cannot be normalized). It is never removed from the
  preview.
- **Duplicate rows.** Exact and `www`-variant duplicates are marked
  `status: "duplicate"` with "Duplicate of row N." and are not re-created.
- **Rows over the plan cap.** Kept in the preview with `status: "over_cap"` and a
  reason; if a previously selected row can no longer be created, the create action
  fails closed with the row's reason instead of writing a partial import.
- **Secret-looking rows.** Rows that look like API keys or private links are
  rejected with an explicit reason and are never imported.

## What MagicBrief data is not portable

The generic importer has no representation for the following MagicBrief data, so
0509 does not import it. The customer must retain it or recreate it manually:

- **Collections and saved ads** — MagicBrief collections and the saved creative
  (ads) inside them have no equivalent in the competitor-list import.
- **Screenshots and creative evidence** — screenshots saved in MagicBrief are not
  uploaded or attached by the import. Keep the original files before closing
  MagicBrief.
- **Analytics and report history** — spend, impressions, reach, and similar
  analytics/report fields are not imported (the preview API reports them in
  `preview.rejectedFields` if present in a CSV) and must be exported and
  retained by the customer or manually recreated.
- **Full export contract** — no real MagicBrief export fixture has been verified
  against this importer. Public MagicBrief shutdown guidance says analytics
  reports can export CSV, but other saved work may require manual recreation;
  until a real export sample is tested, treat the generic import as the only
  supported migration path.

## Manual fallback (truthful)

1. In MagicBrief, open each collection you want to keep and copy the brand names or
   websites into the 0509 competitor import (paste, or build a CSV using the
   accepted columns above — `name, domain, notes, tags, client`).
2. Keep screenshots and creative files locally; the import does not carry them.
   Evidence 0509 captures from scanning the tracked domains is created by 0509
   itself, not migrated from MagicBrief.
3. Export any analytics/report history you need from MagicBrief before shutdown and
   retain it outside 0509.
4. Preview the import and confirm every row's status, then create the watchlists.
   The onboarding UI shows row-level statuses; the rejected columns are returned
   in the preview data (`preview.rejectedFields`) but are not yet rendered as a
   dedicated panel, so keep the original source file until the import is created.

## Rejected-field data contract

`preview.rejectedFields` is the parser/preview data contract for rejected
columns — a `string[]`:

- Named unknown columns appear as their normalized header names (lowercase,
  non-alphanumeric runs collapsed to `_`, e.g. `Campaign Name` → `campaign_name`),
  in first-seen order and deduplicated.
- Headerless CSV overflow columns appear as `column 6`, `column 7`, ... (1-based
  position).
- Plain pasted lines and fully supported CSVs produce `[]`.
- Error previews (oversized import, too many rows) return `[]`.

## Deterministic proof

`tests/magicbrief-migration.test.ts` proves, with sanitized inline fixtures that
contain no PII or secrets:

- every supported input form (pasted lines, header CSV, headerless CSV) parses
  through `buildCompetitorImportPreview` with the mapping claimed above;
- a MagicBrief-analytics-style CSV surfaces every unsupported column
  (`spend`, `impressions`, `reach`, `campaign_name`, `collection`,
  `screenshot_url`) in `preview.rejectedFields` while still importing the
  supported columns;
- invalid and duplicate rows stay in the preview with explicit reasons;
- the guide's accepted-column list stays aligned with the parser's exported
  accepted headers.
