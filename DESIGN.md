# Design Context

## Voice (since 2026-07-20)

Five to Nine speaks like a sharp colleague who did the work — confident,
specific, plain words, lightly warm, zero hedging, zero jargon-as-authority.
The product watched the ads, read the landing pages, and took the screenshots;
the copy should sound like the person who did that, not like the system that
scheduled it.

**Rules:**

1. **Verbs over nouns.** "We checked 24 ads", not "24 ads were checked".
   The product does things; say so in active voice.
2. **Name the thing.** "Screenshot", not "evidence artifact". "Check", not
   "scan operation". Exception: where the proof vocabulary is load-bearing —
   *evidence checks* as a billing unit, *proof* on billed surfaces — keep the
   precise term, because it maps to what the customer pays for.
3. **No exclamation marks in the app.** Confidence is quiet. (Marketing
   surfaces may earn one; the workspace never.)
4. **Sentence case** for body copy, buttons, labels, and headings inside the
   app. Title Case is reserved for proper nouns (Meta Ad Library, Competitors).
5. **Empty states always say what happens next.** Never a bare "No data".
   State what will fill the space and when, or give the one action that fills it.
6. **Errors say three things:** what happened, what we're doing about it, and
   what you can do. In that order, in plain words.
7. **Never blame the user.** "We couldn't read text off this creative", not
   "Invalid input". The system explains itself; it doesn't scold.
8. **Buttons start with a verb.** "See ads", "Track this competitor",
   "Send test email". Never "Submit". Never a bare noun when a verb fits.
9. **No system-speak in customer surfaces.** "Waiting for a monitoring
   worker", "queued for dispatch", "resolve", "workspace readiness gaps" —
   these belong in ops logs, not in the product. Say what it means for the
   customer: "in line to run", "we're retrying", "a few things left to set up".
10. **Specific beats generic, everywhere.** Email subjects lead with the
    competitor or the number, not with the product name. "Nike added 3 new
    ads" beats "Your watchlist digest".
11. **Honesty is untouchable.** Voice changes tone, never facts. A claim that
    was carefully scoped ("no confirmed changes", "demo data — sample results")
    keeps its exact meaning after any rewrite.

## THE system: v4 landing language (ratified 2026-08-08 — read this first)

The design-unification program (tri-audit by Sol + Grok + Fable; ratified by
Nish 2026-08-08) made the v4 landing language — the `--wk-*` token layer and
`f9-wk-*` primitives in `app/app.css` plus `app/components/workspace/*` —
the product's ONLY design system. The Evidence Desk (`f9-ed-*`) and every
earlier era are being wiped, report documents included (their proof
semantics survive verbatim; their skin does not). Enforcement is
mechanical: `scripts/design-system-ratchet.mjs` fails CI when any
legacy-marker count exceeds its ceiling; counts at or below pass, so two
legal sweeps cannot collide in the merge queue. Ceilings only go down,
tightened on main by `.github/workflows/quality-ratchet.yml` (merged
design-system ratchet, #3069).

`f9-evidence-*` is the system's evidence-document vocabulary — the
full-volume proof surfaces (report cover, plates, diff panes) named for
what they are, styled by the same tokens.

The IA is the ratified five destinations — Today, Watch, Library, Deliver,
Settings — with gate-visibility (nothing in the nav a plan cannot use) and
member pages keeping their URLs under an owning destination. Program state
lives in `docs/BACKLOG.md` (the external ledger declared elsewhere was
formally retired 2026-08-25 — it never existed on disk); the mechanical
terminal gate is `docs/design-system-ratchet.json`.

The surviving rules, restated as v4 rules, are: the volume concept
(full-volume deliverables, workspace volume, plain long-dwell surfaces), the
dark-theme token-alias rule, the header-action rule (WP-A3), the badge
semantics (WP-A4), and the voice rules above. What does NOT survive is any
`f9-ed-*` vocabulary or the Evidence Desk chrome — earlier eras are
historical.