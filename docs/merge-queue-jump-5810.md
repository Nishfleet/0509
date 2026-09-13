# Merge queue jump drill (fleet-ops#5810)

This file was created to prove the fleet-ops#5810 repair-queue-jump mechanism
against this repo's live merge queue: a PR labelled `repair:main-red` that
passes its own checks is enqueued at the HEAD of the merge queue
(`enqueuePullRequest` with `jump:true`) instead of tail-appending behind the
entries whose group builds fail on the bug a repair fixes.

Live precedent: 0509#3191 (2026-09-12) sat 57 minutes at the tail of a
14-entry queue until a human jumped it by hand.

This drill PR is labelled `repair:main-red`, armed with auto-merge, then
jumped by `repair-queue-jump.mjs enqueue`. The jump only re-positions the PR;
required checks and the merge-queue ruleset still gate the merge. It is safe
to delete once the drill proof is recorded in
`Nishfleet/fleet-ops#5810`.
