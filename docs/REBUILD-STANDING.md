# Standing: what "#2 of 6 this week" means

Umbrella #3842. Author: Fable. Checked by the Opus deputy. Pairs with docs/REBUILD-JEV.md (D4, D6) and the delivery contract.

## Definition

Standing is the rank of every ON brand in the workspace (you included) by **attention this week**, where attention is what the internet did about the brand in the last 7 days, weighted by how much it matters. It is honest about what it is: attention, not revenue, not traffic. The headline says so on hover: "ranked by what the internet did about each brand this week".

## The score (code, not Jev; every input is ground truth)

For each ON brand, over the trailing 7 days, summed:

| Signal | Count | Weight | Why |
|---|---|---|---|
| Mentions that matter (D6 p >= 0.9) | each | 3 | The core of "across the internet" |
| Mentions, normal (D5 kept, D6 between) | each | 1 | Volume still counts, less |
| Noteworthy site changes (D3 p >= 0.9) | each | 4 | A brand that moves is a brand to watch |
| New ad creatives first seen this week | each | 2 | Spend is intent |
| Ad copy or offer changes | each | 3 | The before-and-after marks |
| Hiring: new roles | each | 1 | Momentum |
| Source reliability | multiplier per item | 0.5 to 1.0 | Scraped and best-effort sources count less; from the source registry's `reliability` column |

Rank by the score, descending. Ties keep last week's order. Weights live in one config table, not in code, and are shown on the "how this is ranked" sheet.

## Movement

Movement is this week's rank minus last week's rank, for brands that were ON both weeks. A brand turned ON this week shows "new", not a movement. A brand turned OFF disappears from the ranking and everyone below it moves up, marked "Casetta paused" in the why-line so a jump is never a mystery.

## The why-line

The sentence under the headline ("Kindred is the mover: 3 new ads and the loudest mention spike") is D4's top reason for the mover of the week. If D4 returned nothing (quiet week), the line is the counts: "Quiet week: 61 mentions checked, 2 site changes, no new ads."

## Rules

- A brand with zero signals ranks last, shown with a dash, never with a score of zero.
- Fewer than 2 ON brands: no ranking, Home says "add a competitor to see where you stand".
- The score is recomputed nightly by the Workflow that closes the day; the week rolls at the user's brief time (Monday 08:00 local) so the email and Home agree.
- Standing is stored per week per brand, so the four-week line chart on Home reads history, not recomputation.

## Proof required

One real workspace with at least four ON brands, two consecutive weekly rollovers, and the stored standing rows cited (brand, week, score, rank, movement) matching what Home and the brief show.
