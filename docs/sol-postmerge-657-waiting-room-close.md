# sol-postmerge-657 waiting-room close-out

Date: 2026-08-14

## Report

Source report: /home/nish/workspaces/agent-state/0509-improvement-loop/sol/postmerge-657.md

## Verdict

Finding HOLDS.

The post-merge defect is real: PR #657's chrome-CTA guard missed the live
persisted value "Menu" + newline + U+200B (code points U+004D U+0065 U+006E
U+0075 U+000A U+200B), so public search could render Meta Ad Library chrome
as the advertiser CTA.

## Named default honored

Post-merge defect is machine-ownable work. The helper
`isAdLibraryChromeCta` in app/lib/meta-library-rendered-card-parser.server.ts
now strips zero-width/format characters (U+200B–U+200D, U+2060, U+FEFF)
before the chrome token match, so "Menu\n\u200B" and "Menu\u200B" normalize
to "menu" and are flagged as chrome.

## What was NOT done

- No production D1 rewrite; already-persisted rows blank on next
  listAdsByIds once the helper matches. No D1 write in scope.
- No deploy, no migration, no payment/checkout/pricing edits.
- No change to isTextCardUiLine or any other export; no scraper/DOM
  extraction changes; no production data cleanup.
- No push, no PR — orchestrator owns push + PR after proof.

## Files changed

- app/lib/meta-library-rendered-card-parser.server.ts — zero-width/format
  strip in isAdLibraryChromeCta normalizer
- tests/meta-library-browser.test.ts — regression test for "Menu\n\u200B"
  and "Menu\u200B"
- tests/ad-persistence-ratchet.test.ts — FIX-14 read-side assertion for
  cta "Menu\n\u200B" (metaAdId chrome-zwsp-menu)
- docs/sol-postmerge-657-waiting-room-close.md — this close-out

## Rollback

Revert the product change (the zero-width strip in isAdLibraryChromeCta)
via `git revert`. Triage Disposition stays QUEUED.
