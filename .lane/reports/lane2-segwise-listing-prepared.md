# Segwise "Best Ad Spy and Competitor Tracking Tools" listing — prepared; this lane delivers the pitch package

**Status: PREPARED and delivered as docs — ready to send; the send step is an owner action (no venue form exists and no repo-local outbound mail path exists).**

Branch: `lane2/segwise-listing-prepared`
Base: `origin/main` at `422fbd55` (#806)

## Item

- [ ] Get Five to Nine listed on Segwise's July 2026 "Best Ad Spy and
  Competitor Tracking Tools" comparison — current-month on-call listing
  item.

## What this lane found

The venue is **not a directory with a submission form** — it is Segwise's
own content program. The target is `https://segwise.ai/blog/best-ad-spy-competitor-tools`
("Best Ad Spy and Competitor Tracking Tools in 2026: Top 7 Compared",
published 2026-07-13, banner "_Updated July 2026_", author Angad Singh —
Segwise's Marketing and Growth, blog category "Tools & Comparisons" which
holds ~100 similar roundups). Seven tools are ranked; six of seven are
third-party products (Meta Ad Library, AdSpy, BigSpy, PowerAdSpy,
SocialPeta, Sensor Tower/Pathmatics), so including an honest, well-argued
new tool at the next update is consistent with the venue's editorial
pattern.

Verified 2026-08-21 (live fetch of the article HTML, the Superblog `.md`
source, the blog, the category page, the author page, and the site privacy
policy):

1. **No public submission path exists.** There is no "submit a tool" page,
   no hosted form, and no sponsored-slot language in the article or blog.
   The only published mailbox on the whole site is `privacy@segwise.ai`
   (privacy-policy-only, Cloudflare-encoded, decoded this lane). The other
   contact surfaces are lead-gen CTAs (cal.com demo booking, free trial).
2. **The realistic path is a direct pitch to the article's author** (Angad
   Singh, LinkedIn `https://www.linkedin.com/in/-angadsingh/`, verified
   live via his author page). That is the person who owns the script and
   its update cadence.
3. **Fit is a real gap, not a stretch.** The article's own taxonomy splits
   the category into raw-feed databases vs AI creative intelligence, and
   its Meta Ad Library entry says the library "does not scale" for
   systematic multi-competitor tracking. Five to Nine (baseline + scheduled
   re-checks + one alert per confirmed change + source-linked screenshot
   proof, Meta ads + public landing pages) is the honest monitoring layer
   between those two shelves — complementary to Segwise's own product.

## Deliverable

- `docs/segwise-listing-2026-08-21.md` — the complete prepared package:
  venue analysis, submission-path verification, taxonomy fit table, a
  paste-ready one-message pitch (LinkedIn DM or email) grounded in the
  venue's own article language, the repo's honesty guardrails, live-URL
  verification (0509.io/, /search, /auth/signup, /compare/magicbrief — all
  HTTP 200 on 2026-08-21), and an explicit next step for the owner.

## Why the send step is an owner action (recorded honestly)

- There is no venue form or account to complete — the whole submission is
  one pitch message.
- No repo-local outbound mail path exists to fire it from this worktree
  (the product's only outbound sender is the production Worker's Cloudflare
  `send_email` binding, which needs production secrets/deploy and is not
  appropriate for a one-off vendor pitch) — same constraint the ad-stack.ai
  lane recorded (`docs/adstack-listing-2026-08-11.md`).
- "Listed" itself depends on the author's editorial update, which no
  preparation can guarantee; this package positions Five to Nine for the
  next update cycle and is not recorded as a confirmed placement.

## Files

- `docs/segwise-listing-2026-08-21.md` — this prepared-listing package.
- `.lane/reports/lane2-segwise-listing-prepared.md` — this evidence record.

## Rollback

N/A — documentation-only; no product code, data, or billing change. The
pitch is not sent by anything in this repo.