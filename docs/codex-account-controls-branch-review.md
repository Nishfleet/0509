# Codex Account Controls Branch Review

Reviewed branch: `codex/0509-saas-account-controls-20260622`

Reviewed against: `main` at `ed109a9`

## Verdict

Do not merge or cherry-pick this branch wholesale.

It has seven unique commits and a broad stale diff. It also adds migrations numbered `0042` through `0044`, which conflict with the current migration chain where those numbers already belong to newer auth, website, and magic-link migrations. Useful product ideas should be reimplemented selectively on top of current `main`, with new additive migrations only.

## Commit Classification

| Commit | Title | Classification | Reason |
| --- | --- | --- | --- |
| `983a3f7` | surface sign out and support controls | Already mostly implemented / superseded | Current app already has account, support, sign-out, and support-case surfaces. Any remaining UI polish should be copied by intent, not patch. |
| `782270e` | add tracked case trail | Useful but stale | Support case history is valuable, but the event migrations conflict with current migration numbering and current support schema has moved. Rebuild later with current schema. |
| `f80a5f5` | add deletion and session controls | Useful but requires redesign | Account deletion and session revocation are high-risk legal/security flows. Do not ship without retention policy, audit trail, and current auth-stack review. |
| `c301b85` | add lifecycle controls | Useful but stale | Team lifecycle controls may be valuable, but current team/workspace routes have changed. Needs a fresh implementation and tests. |
| `678869e` | centralize workspace settings | Superseded for launch | Current staged work already hardens delivery settings and dormant delivery gates. Do not add a separate stale delivery route now. |
| `3e75a8e` | add resume setup path | Useful but non-blocking | Resume onboarding may improve activation, but it is not required for Scout/Starter self-serve readiness and should be evaluated against current onboarding. |
| `4bf27cd` | gate portal subscription management | Partly superseded / owner-gated | Current billing UI is honest and Dodo portal route exists. Full subscription self-serve still depends on Dodo dashboard portal settings, not branch code alone. |

## Safe Follow-Up

1. Create a fresh account-controls plan after this launch PR lands.
2. Rebuild only the safe pieces:
   - session listing/revocation if supported by current Better Auth integration;
   - support case event timeline if it fits the current support schema;
   - team lifecycle controls if current workspace ownership rules are preserved;
   - onboarding resume if it improves activation without duplicating existing flows.
3. Do not implement account deletion until retention, audit, billing, support, and legal/privacy handling are reviewed.
4. Do not reuse the old migration numbers.

No code from this branch was merged in this pass.

## Resolution

The support case event timeline was rebuilt fresh on the current migration chain with `0061_support_case_events.sql`. Case rows now link to a selected-case view, selected cases show customer-visible events, support notification attempts are recorded, and the migration scrubs support alert delivery snapshots down to case IDs.

The old `codex/0509-saas-account-controls-20260622` branch should stay deleted. Session revocation, account deletion, broader team lifecycle controls, and onboarding resume remain deliberate fresh-work items because they need current Better Auth, retention, billing, ownership, and legal/privacy review rather than stale cherry-picks.
