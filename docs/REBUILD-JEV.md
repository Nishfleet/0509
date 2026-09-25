# Jev decision contract for the rebuild

Umbrella #3842. Author: Fable (orchestrator). Checked by the Opus deputy. Implementation detail (SDK calls, schemas) belongs to the engine packets; this doc fixes WHAT is decided, WITH WHAT CONTEXT, and WHAT HAPPENS at each confidence.

## Principles

1. Every typed decision in the product is Jev's, using only the primitives TypeSafe ships: **Noul** (a yes/no that returns a probability), **Choice** (pick one of a list), **Score** (a number on a scale). There is no rank primitive; ranking is composed from per-item Nouls and Scores in code. Code never guesses with regexes or thresholds where a judgment is needed.
2. First opinion only. Thresholds apply per primitive. **Noul:** the output is a probability; act automatically at p >= 0.9 or p <= 0.1 unless a decision below sets its own bar; between, the item is a "maybe": shown to the user, low in the list, with Jev's one-line reason. **Choice and Score:** the returned confidence is how concentrated the distribution is, not permission to act; a Choice is recorded and displayed, and any automatic action it feeds is gated by a Noul. Never re-ask Jev to break a tie.
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

Schema requirements (carried by the schema PR): `user_memory` needs a user-decision record keyed to the signal it was made on; `reliability` is a column on the source registry, not a constant in code.

This pack is the product's edge: a chat prompt has none of it.

## Decisions

| Id | Question (one sentence) | Primitive | Automatic action | Otherwise |
|---|---|---|---|---|
| D1 `is_competitor` | Is `item` (a candidate brand with evidence) a real competitor of `self`? | Noul | p >= 0.9: add, tracking ON. p <= 0.1: drop, remember as rejected | show as "maybe", user confirms |
| D2 `still_competitor` | Given the last 30 days, is `subject` still a live competitor of `self`? | Noul, plus Choice `reason`: active / acquired / shut down / pivoted / dormant | p >= 0.9 active: keep. p <= 0.1 AND reason in {acquired, shut down}: retire with the reason, history kept | ask the user in Competitors; `dormant` and `pivoted` always ask, never auto-retire |
| D3 `noteworthy_change` | Is this diff on `subject`'s `page_role` page worth telling the user? | Noul, plus Choice `kind`: offer / pricing / copy / launch / removal / breakage / unintended / noise | p >= 0.9: publish as a before-and-after mark with the kind. p <= 0.1: discard, log | publish low, marked "possibly" |
| D3s `own_site_breakage` | With `subject == self`: does this change look broken or unintended rather than deliberate? | Noul | **p >= 0.5: immediate alert** (a false alarm costs ten seconds; silence on a broken site costs the customer). p < 0.1: treat as deliberate, hand to D3 | alert marked "check this" |
| D4 `read_this_first` | Does this noteworthy item belong in `self`'s read-this-first for the week? | Noul per item, plus Score `importance` 0..10 for ordering | code takes items with p >= 0.5, orders by Score, shows the top three; none -> "quiet week" with the count of items behind it | n/a |
| D5 `mention_is_about_brand` | Is this mention actually about `subject`, not a homonym or a different entity? | Noul | p >= 0.9: keep. p <= 0.1: discard, log | keep, marked "possibly" |
| D6 `mention_matters` | Does this confirmed mention carry signal for `self` (reach, sentiment, source weight)? | Noul | p >= 0.9: feed + candidate for D4. p <= 0.1: hidden behind "show all" | feed, normal |
| D7 `identity_field_confidence` | Is this extracted value right for this brand's `field`? | Noul per field | p >= 0.9: fill silently. p <= 0.1: leave empty and say what fills it | fill, flagged for the user to confirm |
| D8 `duplicate_signal` | Are these two items the same event seen twice (syndication, repost, re-crawl)? | Noul | p >= 0.9: collapse in the UI, keep both rows. p <= 0.1: keep separate | collapse, show "and 1 more" |
| D9 `page_role` | What role does this page play for `subject`: home / pricing / product / blog / careers / legal / other? | Choice, cached per page by URL + title hash | recorded; feeds D3 and the snapshot schedule | never a URL regex |
| **D10** `public_subject` | Does `item` (a domain, handle or channel) present itself to the public for commercial or audience reasons? | Noul | `p >= 0.9`: proceed. **`p <= 0.1`: refuse**, with the one line "we track brands and creators, not people", and record the refusal | **ask the user** to confirm the subject is a business or public creator, and record their answer in `user_decision` |

Rules per decision:

- D1 never runs on a user-added brand. D2 never auto-retires a user-added brand; it can only ask.
- D3 receives the previous snapshot summary and the diff, never full pages; page roles are home / pricing / product / blog / careers / other.
- D3s runs on every own-site diff before D3. A p >= 0.9 breakage bypasses the weekly cadence and lands in Alerts within one Workflow tick.
- D4 runs once per item per week (and on demand from Home). Its input is only items that passed D3 or D6; it never sees raw data. A week can legitimately have nothing to read first.
- D5 runs before D6 and before any mention is stored as "about the brand"; the homonym problem is the main source of mention noise and is solved here, not with keyword filters.
- D7 fields: name, logo, description, category, country, socials, pricing page. A field below 0.1 is left empty with an empty-state line ("we'll fill this after the first crawl").
- D8 is the only dedup. No hand-rolled fuzzy matching beyond the stored normalized-URL and normalized-title hashes that feed it.
- D9 runs once per discovered page and again only when the title changes. `/plans`, `/membership`, `/tarifs` are pricing pages; a regex would miss them, which is why this is a judgment.
- D10 runs at onboarding before anything is fetched. Where the platform states it, code refuses before Jev and does not ask Jev: a minor (TikTok `ftc`), an account marked private (Instagram `is_private`, TikTok `privateAccount`, X `protected`, YouTube `unlisted`), or a login wall (HTTP 401, or a login URL when no profile flag was readable). A domain or a bare handle has no such flag, so D10 judges it and nothing is fetched.

## What Jev is not used for

- Anything with a ground truth the code can read: HTTP status, hash equality, date math, counts.
- Free-text generation for the user. The one-liners Jev returns as reasons are shown verbatim, marked as Jev's read; longer copy is not generated.

## Proof required in every engine packet that calls Jev

One real run per decision with: the context pack hash, the question id, p, the reason, the timestamp, and the action taken. Invented samples do not count.
