# Plan — issue #2067: indexable /brands/:category landing pages

Manager mode (difficulty: heavy). Existing work on `claim/issue-2067` (commit
`7168b7b5 feat(seo): add indexable /brands/:category landing pages`) is
complete and covers all acceptance bullets. The work is 26 commits behind
origin/main. Plan: rebase, verify acceptance, run tests to green, review,
open PR.

## Acceptance bullets (from issue body)

- [ ] phase 1: rebase existing work onto origin/main, resolve conflicts
- [ ] phase 2: every curated category page returns 200 with its own title/meta, an ItemList schema listing that category's brands, a sitemap entry, and a per-category social card
- [ ] phase 2: /brands hub links to each category page (and vice versa) — no orphan pages
- [ ] phase 2: empty curated category 404s and is omitted from the sitemap (issue #1988 mirror)
- [ ] phase 3: typecheck + brands route tests + sgscan pass to green
- [ ] phase 4: reviewer round (product repo) + adjudication
- [ ] phase 5: PR body contract checks + open PR + arm auto-merge

## Notes

- Reuse existing `groupBrandRecordsByCategory` + `BRAND_CATEGORIES` — no new
  classification source. The 7 curated categories each get a page; "More
  brands" stays on the flat /brands hub (worker's call per issue).
- No D1 migration, no gate-owned path edits, no new data source.
- `usage-uncited` label stands: structural SEO only, no unsourced search-volume
  claims in copy/meta/PR body.
