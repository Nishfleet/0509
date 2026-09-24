# The share image

Umbrella #3842. Pairs with docs/REBUILD-STANDING.md and docs/REBUILD-DELIVERY.md. With no free tier (#3896), this is how customers show the product off.

**Decided by Nish, 2026-09-24:** "the share is simply a screenshot with 0509 branding kind of like spotify shares, solves the privacy issue completely." This replaces the public standing card page (`/s/<slug>`), which was removed. There is no public URL for anything about a customer, so there is nothing to find, crawl, index or leak through a link.

## What it is

A picture the owner makes from Home, in the signed-in app, and posts wherever they like. It shows this week's standing for the workspace's own brand: the brand's name and logo, the rank line ("#2 of 6 this week"), the four-week standing line, the week label in mono, and the `05|09` wordmark with `0509.io`. Nothing else.

**Competitors are not named on it.** The rank says how many brands the owner is up against, not which ones, so their watch list stays private even in a picture they chose to post. This is the default picked when the design changed; naming competitors would be a new decision for Nish.

## How it is made

- **One design, not a twin.** Cloudflare Browser Rendering screenshots the same Home component with the same tokens and fonts, at an explicit **1080×1080** viewport (square works in every feed and story). No second renderer, no SVG template, no canvas drawing by hand.
- **On demand, behind the login.** The owner taps **Share** and the image is rendered from the current rows at that moment. It is never stored at a URL anyone else can open.
- **On a phone** the share sheet opens with the image attached (the Web Share API with `files`). Anywhere that cannot share files, the image downloads instead.
- **Browser Rendering stays inside the 10-session cap** (`docs/REBUILD-COST.md`). If every session is busy, the button says to try again in a minute. It never queues behind the sweeps.

Rejected, recorded so it is not re-litigated:
- A public card page with an unlisted link (built, then removed on Nish's call): a link can be forwarded, crawled and indexed, and it publishes a watch list.
- `@resvg/resvg-wasm`: a 2.5 MB WASM module parsed on every request to the app, with its latest release in 2024.
- `satori`: it does not run on workerd.
- Client-side drawing on a canvas: a second rendering of the design system that drifts silently.

## Rules

- Public data only: the brand's own name and logo, the rank, the count and the standing line. Never mentions text, never own-site incidents, never a competitor's name.
- Rendered from live rows, so a brand that asked to be taken down (`takedown`) never appears, starting the moment the takedown is recorded.
- The landing's sample is the same image, made from a workspace we own for a well-known brand we track ourselves. It is real, never sample data.

## Leftovers

`workspace.card_is_published`, `workspace.card_slug` and `workspace.card_is_indexable` (migrations 0003 and 0010) stay in D1, unused. Migrations are expand-only. Dropping them is a later migration that needs Nish's yes.

## When it gets built

After Home shows the weekly standing. The image photographs that part of Home, so building it earlier would photograph an empty page.

## Proof required

A share image from a real workspace on production, opened in the phone share sheet and posted, and the landing sample rendered by the same path.
