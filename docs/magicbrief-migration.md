# MagicBrief migration promise — what transfers, what is rejected, and proof

Status: engineering truth, code-backed. Last verified: 2026-08-06.

Audience: engineering and support. This is an internal guide; it changes no public page.

Related: public comparison page `app/routes/compare.magicbrief.tsx` (the bounded human-assisted migration promise), `docs/market-desk-first-value-progress.md` (the original generic-import decision), parser `app/lib/competitor-import.ts`, creation flow `app/lib/setup-checklist-action.server.ts`, proof `tests/magicbrief-migration.test.ts` and `tests/competitor-import.test.ts`.

## 1. The truthful promise

- 0509 does not parse a MagicBrief export format. No full MagicBrief export contract is verified, and this repo has no real MagicBrief export fixture. Nothing in this guide claims full migration.
- What exists is the generic competitor-list import already shipped for Market Desk setup: paste lines or a CSV with generic columns. This guide documents exactly what that importer accepts, what it rejects, and what a customer must do by hand.
- If the source includes analytics or report fields, they are not imported and must be retained by the customer or manually recreated.
- Human-assisted migration stays available exactly as the public comparison page promises: email support with the export or a brand list, and collections and watchlists are set up with the customer. This guide adds no time promise and no pricing or legal claims.

## 2. Supported input forms (exactly what the parser accepts)

`buildCompetitorImportPreview` in `app/lib/competitor-import.ts` accepts three forms. The onboarding setup checklist exposes a paste box and a file upload (`.csv`/`.txt`, `app/components/setup-checklist-card.tsx`); a pasted list and an uploaded file can be combined.

1. Pasted lines — one competitor per line. A line can be a plain name, a bare domain, or a full http(s) URL; the website token is pulled out of the line and the rest of the line becomes the name.
2. CSV with recognized headers — header names match case-insensitively after normalization (spaces and punctuation become underscores).
3. CSV without a header row — positional columns, left to right: name, website, notes, tags, client.

### Accepted headers → mapped field

| Field | Accepted headers |
| --- | --- |
| name | name, company, brand, competitor, advertiser |
| website | domain, website, url, site |
| notes | note, notes, description |
| tags | tag, tags (split on `,` `;` `\|`, first 10) |
| client | client, account, customer |

Any other column in a header row is not mapped — see the rejected-field report in section 6.

## 3. What the import mapping does (current behavior)

| Imported data | What happens |
| --- | --- |
| Website | Normalized to `https://host` (www stripped, trailing slash removed, credentials rejected) by `app/lib/competitor-website.ts`; a display name is inferred from the host. Dedup fingerprint is the normalized URL plus the normalized query. |
| Name | Used when the row has no website; becomes the advertiser target label. A row with neither a valid name (at least 2 characters) nor a website is invalid. |
| Country | The import preview uses the visitor's geo country (Cloudflare IP country). |
| Notes | When the row is created, persisted as watchlist-scoped agent memory under `import_context` with source `market_desk_import`. |
| Tags | Same persistence as notes, up to 10 tags per row. |
| Client | Grouping: creates or links a client room when the workspace plan has the `client_reports` entitlement; without it, client labels are still previewed but no room is created. |

## 4. Row outcomes — nothing is silently dropped

Every row lands in the preview with a status and a reason, and the preview data keeps the row's full original text:

| Status | Meaning | Preview shows |
| --- | --- | --- |
| valid | Ready to track (website or name target) | Selected / Ready |
| invalid | Needs edit: bad URL, missing name or website, secret-looking row | the reason text |
| duplicate | Same target earlier in this import (same fingerprint) | Duplicate |
| existing | Already tracked by an active watchlist in this workspace | Already tracked |
| over_cap | Beyond the plan's remaining watchlist slots | Over plan |

Failed rows are never written. At create time, selected rows are re-validated against live state, and secrets in notes, tags, or client labels are rejected before any write.

## 5. Limits

- Paste or upload up to 200,000 bytes (the import error and this guide both display it as 195 KB).
- Up to 250 rows per import.
- Up to 10 tags per row.
- Rows that look like secrets or private links are rejected at parse time; credentials in notes, tags, or client labels are rejected at create time.

## 6. Rejected-field report — unsupported MagicBrief data

A MagicBrief export or handoff typically carries much more than the generic columns above. None of the following is imported:

| Field | Status | Customer must |
| --- | --- | --- |
| ad_spend, impressions, reach, active_days | Rejected — not imported | Retain in the export; recreate manually if needed |
| creatives (count or catalog) | Rejected — not imported | Same |
| screenshot_url and other evidence files (screenshots, videos, ad copy, links) | Rejected — 0509 never imports your evidence; it collects its own evidence after a watchlist starts | Same |
| report_period and analytics report history | Rejected — not imported | Same |
| collection and board structure | Rejected — saved collections and boards do not transfer | Recreate collections in 0509 |
| ad-account hierarchy | Rejected — not imported | Same |
| Any other column beyond section 2 | Rejected — not imported | Same |

Every unsupported field must be retained by the customer or manually recreated. The importer never silently discards what the customer pasted: the preview keeps each row's full original text, and `tests/magicbrief-migration.test.ts` proves that unsupported columns never land in imported fields.

## 7. Manual fallback (the truthful path)

1. Export from MagicBrief. Public shutdown guidance says analytics reports can export CSV; other saved work has no verified export contract and requires manual recreation.
2. Reshape the data to the supported columns in section 2 (name, website, notes, tags, client — only the ones the customer has).
3. Paste or upload in the setup checklist and preview. Work through the section 4 statuses: fix invalid rows, drop duplicates, and note over-cap rows against the plan.
4. Create the watchlists, then recreate collections, boards, and any evidence the customer needs in 0509. Import never restores them.
5. For help, email support with the export or a brand list. The public comparison page's bounded human-assisted promise applies; this guide adds no time guarantee.

## 8. Fixtures and proof

The deterministic fixtures in `tests/magicbrief-migration.test.ts` are the proof of every claim above. They are sanitized (fictional brands, no PII, no secrets) and are reproduced verbatim below; the test asserts these exact strings live in this guide.

### Paste lines — one competitor per line

```text
northstar-shoes.com
https://harbor-tea.shop
Lumen Desk
```

Proves: bare domain, full URL, and plain name each parse; websites normalize to `https://host`; a name-only row becomes an advertiser name target.

### Generic CSV with headers

```text
name,website,notes,tags,client
Aurora Coffee,aurora-coffee.com,Monthly offer rotations,coffee;roast,Retail Group
Maple Ledger,https://maple-ledger.com,Watch pricing page,finance,Client A
```

Proves: every supported column maps to the documented field, tags split, and URLs normalize.

### Generic CSV with alias headers

```text
company,domain,note,tags,account
Willow Sofas,willow-sofas.com,Focus on seat fabric,home;furniture,North Star Retail
```

Proves: alias headers (company, domain, note, account) map to the same fields.

### Positional CSV (no header row)

```text
Trail Works,trailworks.com,Backpack line,hiking;outdoor,West Coast Gear
```

Proves: a headerless multi-column CSV maps name, website, notes, tags, client positionally.

### MagicBrief-style CSV with unsupported columns

```text
name,website,note,tags,client,ad_spend,impressions,reach,active_days,creatives,screenshot_url,report_period,collection
Aurora Coffee,aurora-coffee.com,Campaign notes,coffee,Retail Group,12500,450000,120000,214,12 creatives,https://storage.example.com/evidence/aurora-01.png,2026-01-01..2026-01-31,Spring Campaign
```

Proves: supported columns still map; every unsupported column value stays out of the imported fields and remains only in the row's preserved raw text.

### Row-outcome CSV

```text
northstar-shoes.com
https://northstar-shoes.com
https://not-a-domain
harbor-tea.shop
```

Proves: a duplicate of row 1 is flagged as `duplicate` with a reason, an incomplete domain is `invalid` with a reason, and a row beyond the remaining plan slots is `over_cap` — none is silently dropped.

The same tests also prove the fixtures contain no secrets (they pass the product's own secret detector) and no PII, and that the guide stays aligned with the parser: every accepted header in this guide really maps, every documented rejected field really stays out, and the limit numbers in section 5 match the parser constants.

## 9. Non-claims

This guide does not claim: full MagicBrief migration; portability of collections, tags, or evidence; import of analytics or report history; preservation of screenshots or evidence; or any export format beyond the generic columns in section 2. Until a real MagicBrief export fixture exists, claims stop here.
