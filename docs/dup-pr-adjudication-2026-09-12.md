# dup-PR adjudication: #3275 vs #3300 (twin "measure every surface" /status PRs)

2026-09-12. The tracked work on #3187 ran twice within ~2.5 hours and two PRs
with the same title opened against it: #3275 (head `claim/issue-3187`) and
#3300 (head `fix/status-page-measured`, the branch #3187 pins). Adjudicated
per Nishfleet/0509#3307. This file is the durable end-state record.

## Outcome

- Survivor: #3300, MERGED 2026-09-12T15:46:39Z (its merge closed #3187).
- Loser: #3275, CLOSED 2026-09-12T15:34:59Z, never merged, with a closing
  comment that cross-links the survivor and carries the full hunk verdict.
- Exactly one of the two remains. Termination test on #3307 passes: open-PR
  count among the two heads = 0 (limit 1).

## Diff verdict

Every loser-unique hunk is either carried or listed lost with a reason. Nothing
was silently dropped.

Lost — the `status_health_sample` rail, 10 loser-unique files:
`migrations/0097_status_health_sample.sql`, the writer in
`app/lib/scheduled-observation-health.server.ts`, the `workers/app.ts` wiring,
`tests/status-health-sample.server.test.ts`,
`tests/status-health-sample-migration.test.ts`,
`tests/integration/status-health-sample.integration.test.ts`, the helper stub
in `tests/helpers/scheduled-handler-worker.ts`, the scheduled-handler test
hunk, and the ownership manifest/plan rows for that table.

Reason: the migration re-uses the 0097 prefix that main's landed
`0097_status_probe_samples.sql` already owns, and the rail duplicates a
measurement the landed `uptime` probe already provides (real homepage +
`/api/health` fetches every 5 minutes). One mechanism per concept; the survivor
implements the intent on the rail that already landed, and its version is the
one that went through review.

Carried:

- All six salvage commits of `claim/issue-3187` are present in #3300's history
  as their rebased twins.
- `tests/signup-source.test.ts`, `tests/unsubscribe.route.test.ts`,
  `tests/share-links.test.ts`, `tests/public-markdown.test.ts` are
  byte-identical across the two heads.
- The phrase-ban rewording on `app/routes/brands.$category.tsx` landed in the
  survivor's convergence commit.

State on main at close (re-verified live): `0097_status_probe_samples.sql`
present, `0097_status_health_sample.sql` absent, zero `status_health_sample`
references on main, survivor rail `getPublicStatusProbes` present in
`app/lib/status-probes.server.ts` and `app/lib/public-status-counters.server.ts`.

## Root cause (observe-to-close)

The #3187 tracked work ran twice: a salvage-continuation run carried the
recovered content onto claim branch `claim/issue-3187` and opened #3275 at
10:54Z, while the tracker's pinned branch opened #3300 at 13:30Z. A
claim-lease duplicate-open: nothing tied the salvage run to the branch the
tracker pins. Recorded on #3187 where the tracker sees it, and in the #3275
closing comment. No new machinery added.

Rollback: not needed; the survivor merged. #3275 stays re-openable if this
verdict is ever overturned; its head and files remain reachable via the
closed PR.

## Pointers

- Full hunk verdict: last comment on PR #3275 (cross-links this record).
- Observe-to-close note: last comment on issue #3187.
- Supersession rationale: PR #3300 body, "Supersedes #3275".
- Adjudication issue: #3307 (closed by the PR that adds this record).
