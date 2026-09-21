# Jev decision contract for the rebuild

Umbrella #3842. Author: Fable (orchestrator). Checked by the Opus deputy. Implementation detail (SDK calls, schemas) belongs to the engine packets; this doc fixes WHAT is decided, WITH WHAT CONTEXT, and WHAT HAPPENS at each confidence.

## Principles

1. Every typed decision in the product is Jev's: yes/no, choice, score, rank. Code never guesses with regexes or thresholds where a judgment is needed.
2. First opinion only. Act automatically at p >= 0.9 or p <= 0.1. Between, the item is a "maybe": shown to the user, low in the list, with Jev's one-line reason. Never re-ask Jev to break a tie.
3. Every verdict is logged with the input hash, the question id, p, the reason, and the timestamp. Same question + same input hash = cached verdict, never a second call.
4. The UI never waits on Jev. Judgments run in the collection pipeline (Workflows). An item without a verdict is "unreviewed" and is retried by the Workflow, never dropped.
5. Jev is called through the shipped TypeSafe SDK/plugin, as configured in `~/.config/fleet-ops/seats/typesafe-jev.env` on the fleet and as a Worker secret in production. Nothing hand-rolled around it: no custom retry loops, no prompt templating library, no local fallback model.
6. Cost line: one call per new item, cached by hash; per-brand-per-day budget set in the engine packet; the budget exhausting marks items "unreviewed", it never silently skips.

## The context pack (what "full context" means)

Every call carries one JSON object built from the database, the same shape for every question:

- `self`: the user's brand card (name, domain, category, offer, country, size band, socials).
- `subject`: the brand the item is about (self or a competitor), its card, and its tracking state (on / off / dismissed, user-added or auto).
- `competitor_set`: the other tracked brands (names, domains, categories) so Jev knows the field.
- `item`: the thing under judgment (a candidate, a diff, a mention, a change), with source, URL, captured-at, and the raw evidence excerpt.
- `history_30d`: the subject's last 30 days of noteworthy items (kind, one-liner, date), and for site changes the previous snapshot summary.
- `user_memory`: the user's prior decisions that bear on this: dismissed suggestions, brands turned off, "not noteworthy" marks, confirmed changes on their own site.
- `reliability`: the source's known reliability (official API, RSS, scraped page, best-effort proxy) so Jev can weigh it.

This pack is the product's edge: a chat prompt has none of it.

## Decisions

| Id | Question (one sentence) | Type | p >= 0.9 | p <= 0.1 | Between |
|---|---|---|---|---|---|
| D1 `is_competitor` | Is `item` (a candidate brand with evidence) a real competitor of `self`? | yes/no | add, tracking ON | drop, remember as rejected | show as "maybe", user confirms |
| D2 `still_competitor` | Given the last 30 days, is `subject` still a live competitor of `self`? | yes/no + reason choice: active / acquired / shut down / pivoted / dormant | keep | retire with the reason, history kept | ask the user in Competitors |
| D3 `noteworthy_change` | Is this diff on `subject`'s `page_role` page worth telling the user, and what kind is it? | yes/no + kind choice: offer / pricing / copy / launch / removal / breakage / unintended / noise | publish as a before-and-after mark | discard, log | publish low, marked "possibly" |
| D3s `own_site_breakage` | Same as D3 with `subject == self`: does this look broken or unintended rather than deliberate? | yes/no | immediate alert, not weekly | treat as a deliberate change (D3 kind) | alert marked "check this" |
| D4 `read_this_first` | From this week's noteworthy items across all tracked brands, which three matter most to `self`, and why in one line each? | rank | top three on Home | n/a | n/a (rank always returns) |
| D5 `mention_is_about_brand` | Is this mention actually about `subject`, not a homonym or a different entity? | yes/no | keep the mention | discard, log | keep, marked "possibly" |
| D6 `mention_matters` | Does this confirmed mention carry signal for `self` (reach, sentiment, source weight), or is it noise? | score 0..1 | feed + candidate for D4 | hidden behind "show all" | feed, normal |
| D7 `identity_field_confidence` | For each extracted field of a brand card, is this value right for this brand? | score per field | fill silently | leave empty and say what fills it | fill, flagged for the user to confirm |
| D8 `duplicate_signal` | Are these two items the same event seen twice (syndication, repost, re-crawl)? | yes/no | collapse, keep both rows | keep separate | collapse, show "and 1 more" |

Rules per decision:

- D1 never runs on a user-added brand. D2 never auto-retires a user-added brand; it can only ask.
- D3 receives the previous snapshot summary and the diff, never full pages; page roles are home / pricing / product / blog / careers / other.
- D3s runs on every own-site diff before D3. A p >= 0.9 breakage bypasses the weekly cadence and lands in Alerts within one Workflow tick.
- D4 runs once per brand per week (and on demand from Home). Its input is only items that passed D3 or D6; it never sees raw data.
- D5 runs before D6 and before any mention is stored as "about the brand"; the homonym problem is the main source of mention noise and is solved here, not with keyword filters.
- D7 fields: name, logo, description, category, country, socials, pricing page. A field below 0.1 is left empty with an empty-state line ("we'll fill this after the first crawl").
- D8 is the only dedup. No hand-rolled fuzzy matching beyond the stored normalized-URL and normalized-title hashes that feed it.

## What Jev is not used for

- Anything with a ground truth the code can read: HTTP status, hash equality, date math, counts.
- Free-text generation for the user. The one-liners Jev returns as reasons are shown verbatim, marked as Jev's read; longer copy is not generated.

## Proof required in every engine packet that calls Jev

One real run per decision with: the context pack hash, the question id, p, the reason, the timestamp, and the action taken. Invented samples do not count.
