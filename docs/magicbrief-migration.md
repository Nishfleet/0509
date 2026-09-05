# MagicBrief migration: what imports, what doesn't

Status: internal engineering guide, verified against the generic competitor-list
importer in `app/lib/competitor-import.ts` (the source of truth). The fixture
tests in `tests/magicbrief-migration.test.ts` prove every claim below against
the live parser.

## The honest headline

Five to Nine has **no verified full MagicBrief export contract**. MagicBrief is
closing on July 31, 2026, and its own guidance says analytics/Insights reports
can export CSV while saved collections and boards have no bulk export. We import
a **generic competitor list** (paste or CSV) with the columns below. Everything
else — analytics history, saved collections, boards, attached screenshots and
creatives — is **not imported** and must be kept by you or recreated manually.
We will not claim "full migration" until a real MagicBrief export fixture is
provided and verified.

## Supported input forms (verified)

Both forms go through the same preview: rows are classified as
`valid` / `duplicate` / `existing` / `over_cap` / `invalid`, and nothing is
silently dropped.

1. **Paste, one competitor per line** — a domain (`aurora-retail.example`), a
   URL (`https://aurora-retail.example`), or a brand name (`Driftwood Co`).
   A name and a website on the same line both work.
2. **CSV paste or `.csv`/`.txt` file** — with an optional header row using any
   of the accepted aliases below, in any column order.

Import limits: 200 KB and 250 rows per import; up to 10 tags per row. Rows over
your plan's watchlist limit are marked `over_cap` in the preview and are not
created unless you deselect other rows first.

## What maps into Five to Nine (verified)

| Accepted CSV header aliases | Becomes |
| --- | --- |
| `name` `company` `brand` `competitor` `advertiser` | Watchlist label; if empty, the label is derived from the website |
| `domain` `website` `url` `site` | The tracked competitor target, normalized to `https://…` (brand/competitor website) |
| `note` `notes` `description` | Saved as watchlist import context |
| `tag` `tags` | Saved as watchlist import context (split on `,` `;` `\|`, max 10) |
| `client` `account` `customer` | Client grouping (a client workspace room linking the watchlist) — applied only on the plan that includes client reports |

Without a header row, CSV columns map positionally in this order:
`name, website, notes, tags, client`.

Client grouping is plan-gated: if your plan does not include client reports,
the client label is not grouped into a room, so keep your own client record.

## What does NOT transfer (not imported, must be kept or recreated)

- **Analytics and report history are not imported** — spend, reach, impressions, clicks, and any other Insights/report columns from a MagicBrief CSV export stay in your original file; Five to Nine builds its own change evidence from fresh checks.
- **Saved collections and boards (Inspire)** with attached screenshots,
  creatives, and notes — there is no verified bulk export, and the generic
  importer has no representation for them.
- **Screenshots and downloaded evidence are not imported** — keep your original files; the importer never reads or writes them.
- **Team members, permissions, saved views, and workspace settings.**

## Rejected-field report

The import preview reports **rejected fields**: any CSV column whose header is
not one of the accepted aliases, or any positional column beyond
name/website/notes/tags/client, is surfaced as a rejected field
(`preview.rejectedFields`) and is **never written anywhere** — it is not
silently discarded. Verified by `tests/magicbrief-migration.test.ts` with a
MagicBrief-like fixture (`advertiser,domain,notes,tags,client,spend,reach,
impressions,last_seen`).

Even with a rejected field, the rows themselves still import with their
supported columns, and every rejected column remains in your original file.

## Manual fallback

1. Export what you can from MagicBrief (analytics CSV where available).
2. Import the competitor list through the onboarding "Add several competitors
   by paste or CSV" step.
3. Recreate saved collections and boards manually in Five to Nine Collections,
   re-uploading your own screenshots and files — the importer never touches
   evidence files, and Five to Nine collects its own proof for new checks.
4. For person-assisted migration (collections/watchlists set up with you),
   email support as described on the public migration page at
   `/compare/magicbrief`.

## Verification

```sh
npx vitest run tests/magicbrief-migration.test.ts tests/competitor-import.test.ts
npm run typecheck
npm test
```

## Source of truth

- `app/lib/competitor-import.ts` — parser, header aliases, row statuses,
  rejected-field report, limits.
- `app/lib/setup-checklist-action.server.ts` — how rows are created and how
  notes/tags/client are persisted.
- `tests/competitor-import.test.ts` and `tests/magicbrief-migration.test.ts` —
  deterministic proof.
