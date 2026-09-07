# AI Crawler Policy — robots.txt vs llms.txt

Date: 2026-08-11
Status: Decided
Scope: public surface only (`robots.txt`, `/llms.txt`, public markdown pages)

## Decision

**GEO participation with a training carve-out — "answers yes, training no".**

- Search engines and AI answer/reference engines are welcome and may consume
  public pages and `/llms.txt` (`search=yes`, `ai-input=yes`, `use=reference`).
  This includes Googlebot (search and AI Overviews), Bingbot, PerplexityBot,
  OAI-SearchBot, ChatGPT-User, and Claude-By-Cloudflare (Claude.ai answer
  access for Cloudflare-hosted sites). They match the `User-agent: *` allow
  group in `app/lib/seo.ts` robots.txt.
- AI training/fine-tuning crawlers are denied (`ai-train=no`): GPTBot,
  ClaudeBot, Google-Extended, CCBot, Bytespider, Amazonbot, Applebot-Extended,
  meta-externalagent, and CloudflareBrowserRenderingCrawler (enforced by the
  Cloudflare edge managed-robots block, not duplicated in the repo robots.txt).

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
- Denying training crawlers does not cap AI-answer traction: answer engines
  (PerplexityBot, OAI-SearchBot, ChatGPT-User, Claude-By-Cloudflare, Googlebot
  for AI Overviews) are not on the deny list. ClaudeBot stays denied as
  Anthropic's training crawl; Claude.ai answers remain reachable via the
  allowed Claude-By-Cloudflare crawler.

## What it means

- `app/lib/seo.ts` robots.txt carries the wildcard allow/disallow rules and
  the Sitemap; the Cloudflare edge managed-robots feature is the source of
  truth for the AI-training deny list so the same deny block is not repeated.
- `/llms.txt` documents the same policy in its "AI access" section, using the
  shared `AI_TRAINING_CRAWLERS` constant.
- The worker sets `content-signal: search=yes, ai-input=yes, ai-train=no,
  use=reference` on `/llms.txt` and public markdown responses, matching the
  robots.txt declaration.
- The Cloudflare edge managed robots.txt remains the enforcement layer for
  the deny list at the zone; the repo keeps the shared constant in sync with
  the zone config.

## Reference for the traction loop

This resolves the scout-filed backlog item "Decide and align robots.txt vs
llms.txt: AI crawlers (GPTBot/ClaudeBot/Google-Extended) are denied while
GEO/AI-answer work assumes AI surfacing". GEO participation is intentional;
the deny list and llms.txt are consistent. The loop should stop flagging the
AI crawler denies as contradicting AI surfacing, and AI-answer outcome
metrics remain valid traction signals.

## Rollback

Re-add the AI-training deny block to `app/lib/seo.ts` and/or the llms.txt
"AI access" section in `app/lib/public-markdown.ts` — both are declarative
files, one-line rollbacks.
