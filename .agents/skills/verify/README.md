# verify

`SKILL.md` starts the app and drives it. `feature-map.md` and `feature-map/` list every route, how to reach it and what it should do, one row per file. `tests/unit/feature-map-proof.test.ts` fails when a route in `app/routes.ts` has no row, or a row names no spec.

## Keep the map true

The PR that changes a route changes its row. On top of that, run `/maintain-verification-skill` from Lauren Tan's pstack after a busy week. It reads each feature from source, drives every feature live with this skill and opens at most one PR of proven fixes to this folder. It never edits product code. A broken feature it finds is an issue, not a map edit.
