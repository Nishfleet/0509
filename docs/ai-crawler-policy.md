# AI Crawler Policy — robots.txt vs llms.txt

Date: 2026-08-11 (updated 2026-09-09, issue #2061)
Status: Decided
Scope: public surface only (`robots.txt`, `/llms.txt`, public markdown pages)

## Decision

**GEO/AEO participation with a training carve-out — "answers yes, training no".**

- Search engines and AI answer/reference engines are welcome and may consume
  public pages and `/llms.txt` (`search=yes`, `ai-input=yes`, `use=reference`).
  This includes Googlebot (search and AI Overviews), Google-Extended (Gemini
  grounding / AI Overviews — reference use, NOT training), Bingbot,
  PerplexityBot, OAI-SearchBot, ChatGPT-User, and Claude-By-Cloudflare
  (Claude.ai answer access for Cloudflare-hosted sites).
- Grounding / AI-answer engines are allowed on the public proof surface by
  explicit `User-agent` groups in `app/lib/seo.ts` robots.txt (`Google-Extended`,
  `OAI-SearchBot`, `PerplexityBot`), not just the `User-agent: *` wildcard — the
  AEO posture is intentional, not accidental. "Grounding" is reference use,
  which `search=yes, use=reference` already grants; it is NOT training.
- AI training/fine-tuning crawlers are denied (`ai-train=no`): GPTBot,
  ClaudeBot, CCBot, Bytespider, Amazonbot, Applebot-Extended,
  meta-externalagent, and CloudflareBrowserRenderingCrawler. Google-Extended is
  deliberately NOT in this set — here it is an answer/reference engine
  (issue #2061). ai-train=no is NOT weakened.

## Why

- The site publishes a maintained, current `/llms.txt` (current product truth)
  and the product loop is actively working AI-answer readiness. Privacy-by-
  default would declare that work contradictory waste, which it is not.
- Public pages carry marketing and product-truth content only; account,
  competitor, and evidence data live behind auth and are never public. There
  is no customer data at stake in the public crawl surface.
- The live edge already declares `Content-Signal: search=yes, ai-train=no,
  use=reference` via the Cloudflare managed robots.txt. This decision makes
  the repo robots.txt, the content-signal headers, and llms.txt consistent
  with that edge stance instead of silently contradicting it.
- Before issue #2061, `Google-Extended` was grouped with the training deny
  list, which hid Gemini grounding / AI Overviews (the largest AI answer
  surface) from the public proof pages the direction#4518 AEO bet and the
  `/llms.txt`-family work publish. Grounding is reference use and the
  content-signal already grants it, so blocking Google-Extended contradicted
  the site's own `search=yes, use=reference` signal.
- Denying training crawlers does not cap AI-answer traction: answer engines
  (PerplexityBot, OAI-SearchBot, ChatGPT-User, Claude-By-Cloudflare, and
  Google's Googlebot + Google-Extended for AI Overviews/Gemini) are not on the
  deny list. ClaudeBot stays denied as Anthropic's training crawl; Claude.ai
  answers remain reachable via the allowed Claude-By-Cloudflare crawler.

## What it means

- `app/lib/seo.ts` robots.txt is the explicit, self-contained matrix:
  the wildcard group (public allow, `/app/$` + `/app/` + `/api/` + `/export/`
  disallow, Sitemap), the explicit grounding-engine groups (`Google-Extended`,
  `OAI-SearchBot`, `PerplexityBot`) with the same public-allow/private-disallow
  shape, and one `Disallow: /` per `AI_TRAINING_CRAWLERS` training crawler.
- `GROUNDING_ENGINES` and `AI_TRAINING_CRAWLERS` are shared constants so
  robots.txt and the `/llms.txt` "AI access" section can never drift apart.
- The worker sets `content-signal: search=yes, ai-input=yes, ai-train=no,
  use=reference` on `/llms.txt` and public markdown responses, matching the
  robots.txt declaration.
- The Cloudflare edge managed-robots feature remains the enforcement layer for
  the training deny at the zone; the repo robots.txt carries the same policy for
  the worker-served surface, and the shared constant stays in sync with the
  zone config.
- Residual (loose-ends): the currently-deployed `/robots.txt` at `0509.io` is
  served by Cloudflare Managed robots (zone), which still lists
  `Google-Extended` under `Disallow: /`. Removing that zone-side Google-Extended
  block is a Cloudflare zone change, outside repo deploy scope; the repo robots
  policy+test above is the source of truth that must be reflected at the zone.

## Reference for the traction loop

This resolves the scout-filed backlog item "Decide and align robots.txt vs
llms.txt: AI crawlers (GPTBot/ClaudeBot/Google-Extended) are denied while
GEO/AI-answer work assumes AI surfacing", and tightens it for the AI-overview
surface: Google-Extended (Gemini / AI Overviews grounding) is now allowed on
public proof pages, so the AEO bet (direction#4518) is not blocked at the
door. The loop should stop flagging the training-crawler denies as
contradicting AI surfacing; AI-answer outcome metrics remain valid traction
signals.

## Rollback

Remove the explicit `GROUNDING_ENGINES` groups (or move
`Google-Extended` back into the training-deny list) in `app/lib/seo.ts` and
re-sync the "AI access" section in `app/lib/public-markdown.ts` — both are
declarative files, one-line rollbacks. Revert the test
`tests/robots-aeo-policy.test.ts` with it.