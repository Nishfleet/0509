# Task Brief: Presence Desk Pivot First Slice

Implement the first slice of `docs/plans/2026-07-02-002-feat-presence-desk-pivot-plan.md` in this worktree.

Read the plan's Goal Capsule, Product Contract, Planning Contract, Verification Contract, and Definition of Done before editing. The plan is authoritative.

Scope for this pass:

1. U1 Product Vocabulary And Docs Contract.
2. U3 Source Coverage Policy.
3. U4 Presence UI Repositioning.
4. U5 Entity Brief Builder for the currently safe website/open-web source only.

Hard boundaries:

- Do not enable or claim active Amazon, YouTube, X, Reddit, LinkedIn, or Context.dev coverage unless the plan's provider-specific gates are actually satisfied.
- Do not call provider/admin APIs from browser code.
- Do not mutate billing, pricing, auth, workspace ownership, or delivery semantics.
- Keep existing competitor/Market Desk behavior working; competitors become one tracked entity type, not a removed product path.
- Preserve Presence safe-fetch, robots, rollout, entitlement, and credential gates.

Expected result:

- 0509 has a truthful proof-backed entity tracking product contract and first UI/data slice.
- Source coverage is centralized and reused instead of hand-written in multiple places.
- Entity briefs show state, proof, source confidence, and next actions without fabricated data.
- Tests are added or updated for changed behavior.

Before handing back:

- Run focused tests for changed code.
- Run `npm run typecheck`.
- Run `npm test` if the diff touches shared Presence/API behavior.
- Run `git diff --check`.
- Report any skipped full gates with the exact blocker.
