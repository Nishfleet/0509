# The public standing card

Umbrella #3842. Author: Fable. Checked by the Opus deputy. Pairs with docs/REBUILD-STANDING.md and docs/REBUILD-DELIVERY.md. With no free tier (#3896), this card is how the product is seen before it is bought, and how customers show it off.

## What it is

One public page per workspace, off by default, that shows this week's standing for the workspace's brand against its ON competitors: the rank line ("#2 of 6 this week"), the four-week standing line, the three read-this-first marks with their before-and-after, and the counts checked. Nothing else. It looks like the top of Home, in the same skin, with the product's name as a small footer and one action: "Track your own brand".

## Two uses

1. **Customer share.** A paid user turns it on in Settings, gets a URL (`0509.io/s/<slug>`) and an OG image rendered from the same data, and posts it. The URL is the growth loop.
2. **Landing sample.** The landing shows a real card for one well-known brand we track ourselves (a public workspace we own), refreshed weekly by the same pipeline. Not a mockup, not sample data: the card is proof the product is running. The brand is chosen for recognisability and for having active, public competition (a DTC brand with visible ad libraries).

## Rules

- Public data only: brand names, domains, logos, counts, rank, and marks whose source is a public URL. Never mentions text beyond the headline, never the user's own-site incidents, never anything from a paid-scraper source until Nish approves that source for public display.
- Competitors named on a customer's card are that customer's choice: turning a competitor off removes it from the card on the next render. Dismissed brands never appear.
- The card is cached at the edge and rendered on the weekly rollover, plus on demand when the owner toggles it; it never queries live. Cost: one render per workspace per week.
- The slug is opaque and rotatable; turning the card off returns 404 within a minute (cache purge), and the OG image goes with it.
- No login, no cookies, no tracking beyond Cloudflare Web Analytics.
- Unlisted by default (Nish, 2026-09-24): a card is served with `X-Robots-Tag: noindex` and left out of `/sitemap.xml`, so only people the owner sends the link to find it. The owner can let search engines list it from Settings, only after ticking a box that confirms anyone searching will see their rank and every competitor they track, and that search engines can take days or weeks to drop it again. Turning the card off forgets that choice.
- One CTA. Its price is on the button (Scout monthly, from the ledger).

## Proof required

A customer card and the landing sample both live on production, rendered by the pipeline (render id, timestamp), OG image validated with a card debugger, toggle-off proven to 404 within a minute, and the landing's LCP still under 1.5 s with the card in the first viewport.
