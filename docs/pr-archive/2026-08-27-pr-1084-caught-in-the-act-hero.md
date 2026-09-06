# PR #1084 — "Caught in the act" price-diff hero: close-with-evidence

Status: **closed with evidence** (2026-08-27 decision, archived 2026-09-05).

## What this records

PR #1084 (`feat/restore-caught-in-the-act-hero`) restored the #188 typographic
price-diff hero (`They cut the price ~~$159~~ $129 03:47 AM last night`) as the
homepage first viewport. It is a stale, conflicting pull request against the
current `origin/main`.

## (i) The conflict with the shipped Safe hero

The homepage now ships the **BET 9 Safe** first viewport, chosen and recorded
in `docs/design/hero-directions/CHOSEN.md` on 2026-08-27 (issue #1173):

- H1: "Growth teams who track competitors know the offer proof before the call."
- Live proof sits in a strip under that headline, not in the H1.

PR #1084 restores a data-independent illustrative price-diff block in the H1
position — the exact thing the 2026-08-11 "kill sample/illustrative demos" work
removed, and the exact thing the Safe direction deliberately keeps out of the
first viewport. The two directions disagree on what the first viewport is for.

## (ii) Nish's original call

On 2026-08-26 Nish asked for the #188 hero to return. The PR body records that
call and deliberately reverses the kill-demos work for "this element and this
element only", keeping every real proof claim (shot cards, ticker, brief strip)
from the cache-only loader intact.

## (iii) The decision not to restore #188 on top of Safe

The Safe hero shipped on `main` after Nish's 2026-08-26 call. No fresh Nish
confirmation exists for restoring #188 **after** the Safe ship. Under issue
#1307 accept rule 3, landing (#1084 outcome a) is barred without that fresh
Nish confirmation "after the Safe ship", because restoring #188 re-introduces a
sample/illustrative demo into the first viewport that contradicts the shipped
Safe direction.

Therefore the unmerged PR is closed with this evidence rather than rebased and
landed. Nish's 2026-08-26 call is **not** dropped — it is recorded here and in
the PR body so it is not re-derived from scratch by a later intake.

## (iv) Smallest next action if Nish re-opens the call

If Nish decides the #188 hero should lead the first viewport again, in direct
view of the shipped Safe hero:

1. Say so explicitly here or in a fresh issue, after the Safe ship. That is the
   missing fresh confirmation that #1307 accept rule 3 requires.
2. Rebase `feat/restore-caught-in-the-act-hero` onto current `origin/main`.
3. Confirm the restored hero does not regress the #1304 / #1286 honesty gates on
   the proof strip, and resolves conflicts against the Safe first viewport.
4. Land it as a new PR (do not reopen this archive as the merge path).

A public-facing pricing/competitor claim in the restored hero stays
`[NISH]`-gated per issue #1307 accept rule 4.
