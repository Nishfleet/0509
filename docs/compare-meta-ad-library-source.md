# Meta Ad Library — sources for /compare/meta-ad-library

The claims on `/compare/meta-ad-library` are grounded in Meta's own Ad Library
surfaces plus the two external sources cited on the page (issue #2141). Every
cited URL and the date it was checked:

- Meta Ad Library: https://www.facebook.com/ads/library/ — checked 2026-08-28.
  Meta's public library of currently running ads; free, no account, open to
  everyone. It is the same public archive Five to Nine reads for its checks.
- Meta Ad Library help: https://www.facebook.com/help/adslibrary — checked
  2026-08-28. Meta's own help documentation describing the Ad Library as the
  public surface for ads running across its platforms.
- AdLibrary, "Limitations of Meta Ad Library 2026: The Complete Audit"
  (published May 17, 2026):
  https://adlibrary.com/posts/limitations-of-meta-ad-library-2026 — checked
  2026-09-09 (issue #2141). Documents that the Meta Ad Library has no follow
  mechanism, no saved searches, no export and no alerts, and that commercial
  ads drop out of the searchable library once they go inactive (no published
  retention SLA for standard commercial ads).
- Apify actor jy-labs/meta-ad-library-multi-search-scraper:
  https://apify.com/jy-labs/meta-ad-library-multi-search-scraper — checked
  2026-09-09 (issue #2141). Priced at "$10 per 1,000 results" (platform usage
  and residential proxy included); with `onlyNewAds: true` on a schedule, each
  run returns only the ads that search has not returned before — new-ad
  detection. It delivers no landing-page diff, no offer timeline, no
  screenshot proof, and no worth-action verdict.
