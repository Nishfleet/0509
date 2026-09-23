## Verification

Required for any PR that touches `app/` or `workers/`: the verify-skill
commands run against the PR head and their pasted output. The procedure is
`.agents/skills/verify/SKILL.md` — start the app, drive it, and paste the
proof for the change type (snapshot plus console-error and network checks for
correctness; the trace with LCP breakdown for performance; the heap diff for
memory; the screenshots for layout). A PR that touches neither says so here.
