# Landing redesign build brief — "Caught in the act" (2026-06-12)

Winner of a three-direction Mobbin-led exploration (safe "daylight ledger" / bold "night shift" / weird "morning newspaper" all rejected by Nish as too quiet; this fourth, louder direction approved: "LOVE IT").

## References (Mobbin)

Remixed from ≥3 sources, none dominant: Savee (full-screen typographic wall), Ditto (highlighted-word annotation block), Better Stack (timestamped evidence timeline language), Arcade (URL-input-as-hero moment), Peec AI (competitor change table). Anti-references: Stitch (purple-blue AI gradient — never), Base44 (countdown-promo noise — wrong trust register).

## Concept

The hero IS a product demo: a sample competitor change rendered as a giant typographic diff —
"THEY CUT THE PRICE ~~₹2,400~~ ₹1,999 LAST NIGHT." with strikethrough (deletion) and green
highlight (insertion) plus a timestamp flag. A continuously scrolling capture ticker runs across
the top of the page. Detective/case-file framing throughout ("sample case file", "recording",
"evidence on file", "catch them in the act").

## Rules

- Section order: ticker → nav → type-wall hero (sample-labeled) + live-search command bar →
  "Know when competitors change the offer." how-it-works → proof loop (id="demo", case-board
  styling) → zero-noise → "Stop finding out after the sales call." stats → pricing (watch depth)
  → bundles → footer.
- Typography: Bricolage Grotesque 800 (display, uppercase, clamp 44→122px, -0.045em) /
  Inter (body, stays `--f9-font`) / IBM Plex Mono (timestamps, tickers, evidence chips).
- Color: bone `#F4F1E8` ground, ink `#0E0D0A`, ONE accent green `#16C47F` (insertions, live
  markers, CTA arrows). Red `#E0442C` is diff-deletion semantic only. No gradients anywhere.
- CTA hierarchy: 1) command-bar live search (GET /search, no account), 2) Start watching
  (signup), 3) sample proof links (small, mono).
- Proof: every sample is explicitly labeled sample ("SAMPLE CASE FILE", "Honest by design"
  note kept). No unsourced claims. Currency in the sample story mirrors the existing Nykaa
  sample-market data; product copy stays global-first (no IST promises — "the 05:09 brief,
  in your timezone").
- Mobile: type wall scales via clamp, ticker persists, command bar stacks, no horizontal
  scroll. Reduced motion: ticker and blink animations pause.
- Performance: two font families added via Google Fonts with display=swap; no images; CSS only.
