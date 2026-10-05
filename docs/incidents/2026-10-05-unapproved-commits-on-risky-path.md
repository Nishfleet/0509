# 2026-10-05: two unapproved commits reached production on a risky path

## What customers saw

Nothing reported. The change that went live reads a customer's saved Slack address and, if it is still plain text, rewrites it as encrypted text during the read. If that rewrite failed (a failed database write or a bad key), the Settings page and the Slack alert sender would have thrown where they used to work. No such failure has been observed; nobody can read production logs from the fleet, so "none seen" is not "none happened".

## Start and end (UTC)

- 2026-10-05 02:54 the coordinator approved Slack encryption PR #6976 at head e63250a (`SLACK_TARGET_SECRET` was set that minute).
- 06:48 the issue's worker hit its three-run cap and parked for the orchestrator.
- 06:49 to 06:54 the orchestrator merged the worker's branch into `orch/issue-6398` and added two commits of its own: db099ca (rewrite plaintext rows on read) and e9b7f4a (one helper for the key).
- 06:54:10 the orchestrator opened #7092 and armed auto-merge. 06:54:18 it added the `needs-coordinator` label, eight seconds later.
- 07:29 #7092 merged. The production deploy of that merge (run 37278024097) finished successfully at 07:51.
- Open until the read-path fix (#7096) deploys.

## Root cause

The `needs-coordinator` label is a request that nothing enforces. Three facts, each checked:

1. The orchestrator prompt tells it to arm auto-merge on every PR it opens (`prompts/orchestrator-handoff.md` in fleet-ops: "Arm auto-merge: the required checks gate it"), so the orchestrator armed #7092 as written.
2. The only automatic hold is the worker's arm step in `agent.yml`: it declines to arm a `claim/issue-*` PR on a risky path and labels it. It never sees an `orch/issue-*` PR, and it does not run again when someone arms by hand.
3. The approval was for one head (e63250a) plus "a clean main-merge". The merged head carried two further commits that change `app/lib/data/send_target.server.ts`, and nothing compared the merged head with the approved one. The PR had no review on it. The ruleset on `main` needs only the `ci-ok` check: zero required reviews, no code-owner review, no dismissal of stale approvals.

So the fleet's own checks were green on code nobody had approved, which is what a green check proves and no more.

Not proven: why the orchestrator added the rewrite-on-read commits. Its PR body says the issue asked for existing rows to be migrated and a SQL migration cannot encrypt. That is a fair reading of the issue, and the planned answer was the backfill in #6981.

## How it was detected

The coordinator noticed it when checking the landing against the approved head. No alert exists for this.

## The fix

- #7096 restores `send_target.server.ts` and its test to the approved state: reads decrypt or return old plain text, and never write. Sealing old rows stays with the backfill in #6981.
- Production deploy of the original merge succeeded, so `SLACK_TARGET_SECRET` was present.

## What stops a repeat

Ranked by the correction ladder in `CLAUDE.md`.

1. Static gate (fleet-ops, proposed, not yet merged): a job that runs when auto-merge is turned on, when a label is added, or when a commit is pushed to a `needs-coordinator` PR. If the head has no success status named `coordinator-approval`, it turns auto-merge off and takes the PR out of the merge queue. A commit status belongs to one commit, so every new push needs a new approval, with no list of approved heads to keep. This closes the arm-then-label order seen here, the label-then-arm order, and the push-after-approval order.
2. Same rung, a larger step that needs Nish: turn on code-owner review and dismissal of stale approvals in ruleset 21391031, with the risky paths in `CODEOWNERS`. That is the stock GitHub mechanism, but it is a production settings change and the approver would need to be an account other than the PR's author.
3. Rule: the orchestrator prompt should label before it arms. Prompts are the weakest rung, so this only narrows the gap until rung 1 exists.

Known gap after rung 1: it holds only PRs that carry the `needs-coordinator` label. An orchestrator PR on a risky path that is never labelled would still arm. Rung 2 closes it.
