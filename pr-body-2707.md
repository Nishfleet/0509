Fixes #2707

**Choice: (a) — re-pin the 13 IBM Plex Mono rules from 700 to 600.**

The stylesheet loads Plex Mono 400/500/600 only (app/root.tsx:108), so every one of the 13 rules already renders from the 600 face. Re-pinning the CSS to 600 makes the rules and the loaded weight set agree while changing nothing on screen — byte-neutral, no new font download (option (b) would add ~15.6 KB to first view). This is why no design owner round-trip is needed for (a): pixels are identical before and after.

Diff: 13 lines in `app/app.css`, nothing else; files match the issue's `files:` list exactly.

Verification:
- `npx vitest run --configLoader runner --project node --changed origin/main` → 6 files / 27 tests passed.
- Post-fix scan: 0 remaining rules in app/app.css with `font-weight: 700` and a mono font-family (was 13).
- First-view font payload: unchanged (a = byte-neutral; no stylesheet/weight-set change).

run-proof: verified-by-run (vitest changed-mode run above, 27/27 green); CI will run the full suite + typecheck on this PR.

loose-ends: none — single-file CSS-only change.
