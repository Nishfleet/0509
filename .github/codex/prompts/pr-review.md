# 0509 PR Review

Review this pull request in a bug-first, launch-safety-first style.

Prioritize:
- correctness bugs
- production or deployment regressions
- missing tests around changed behavior
- broken auth, billing, alerting, discovery, cache-vs-live, or Cloudflare runtime assumptions
- security, secret, or account-safety risks

Rules:
- Read only. Do not edit files.
- Do not run deployments, pushes, merges, account actions, or production mutations.
- Do not spend review space on style nits unless they hide a real bug.
- Prefer exact file and line references.
- If you find no blocking issue, say so plainly and name the remaining test or runtime gap.

Output:
- Start with findings ordered by severity.
- Then add `open questions` only if they could change the merge decision.
- End with `merge posture`: `block`, `fix first`, `safe after checks`, or `no concerns found`.
