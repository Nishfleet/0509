# Incidents

One short, blameless postmortem per customer-visible incident, named `YYYY-MM-DD-<slug>.md`.

Each file has these sections, in this order:

1. **What customers saw**
2. **Start and end (UTC)**
3. **Root cause**, with the evidence that proves it. Write "not yet proven" and list what is known until it is.
4. **How it was detected**
5. **The fix**, with PR numbers
6. **What stops a repeat**, ranked by the correction ladder in `CLAUDE.md`: code and lint first, docs last.

Failure reasons from the judge are in the `jev_failure` table once #6927 is deployed.
