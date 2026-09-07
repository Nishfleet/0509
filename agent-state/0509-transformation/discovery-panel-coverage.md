# Discovery panel coverage

Generated: 2026-08-26T00:00:00.000Z
Covered: 8/12

| Domain | Ads | Covered |
|---|---:|:---:|
| allbirds.com | 9 | yes |
| notion.so | 2 | yes |
| ouraring.com | 4 | yes |
| nykaa.com | 6 | yes |
| gymshark.com | 3 | yes |
| hubspot.com | 1 | yes |
| ridgewallet.com | 2 | yes |
| bombayshavingcompany.com | 5 | yes |
| curofy.com | 0 | no |
| mailchimp.com | 0 | no |
| canva.com | 0 | no |
| plausible.io | 0 | no |

Inner-loop harness fixture (8/12). The 6-hourly discovery_warmup now also writes search-v2 domain keys for this panel with a 24h public-search-readable TTL. Live production coverage is the post-deploy cron outcome; this PR does not force live scrapes against 0509.io.
