# Lane evidence records

This file is a frozen index. Do not append lane evidence here: this single
tracked file was once edited by 25 open PRs at the same time, and every second
writer conflicted. Lane evidence now lives in one file per record under
`.lane/reports/`, so concurrent lane PRs never touch the same path. See
`.lane/README.md` for the convention. CI fails any PR that grows or rewrites
this file; only net-removing migrations that move records out are allowed.

Historical records, kept verbatim in one file per record:

- [MONEY silent-failure remediation](reports/money-silent-failure-remediation.md) — PRs #445/#446/#447
- [Deploy restore-evidence self-generation remediation](reports/deploy-restore-evidence-self-generation.md) — PR #545
- [Home slow-rendered-load dogfood verification](reports/home-slow-rendered-load-dogfood.md) — PR #560
- [Homepage top-nav signup CTA + magic-link next-step verification](reports/homepage-nav-signup-cta-magic-link.md) — PR #562
- [AI Answer Readiness: rendered pages lack extractable detail](reports/ai-answer-readiness-content-depth.md) — PR #566
- [Brand "is running"/owns-Meta-ads claims on visitor pages](reports/brand-is-running-owns-meta-ads.md) — PR #597
- [Alert named owner + materiality reason](reports/alert-named-owner-materiality.md) — PR #605
- [BetaList manual listing](reports/betalist-manual-listing.md) — PR #609
- [Stale open PRs #573/#574/#584](reports/stale-prs-573-574-584.md) — PR #615
- [Daily market-signal D1 snapshot restore](reports/market-signal-snapshot-restore.md) — PR #586
