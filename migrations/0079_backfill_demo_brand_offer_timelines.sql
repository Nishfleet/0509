-- Backfill one dated offer state for each of the 5 flagship demo brands so
-- the public Offer Timeline is not empty on day one (issue #968, BET 3 part 3/4).
--
-- Honesty contract (issue accept criteria):
--   * No screenshots are fabricated. Every backfilled row carries
--     artifact_key = NULL and metadata_json marks it `backfill: true` with
--     `source: demo_brand_seed`. The Offer Timeline renders the honest
--     "Captured on <date>, no screenshot" label for these rows.
--   * capture_method = 'demo_backfill' is never produced by the live
--     monitoring write path (#952), so a future audit can tell seeded rows
--     from real captures.
--   * Headlines are each brand's standing public positioning line, not
--     invented sale events, prices, or CTAs. One dated state per brand is
--     enough to satisfy ">=1 dated state"; a richer ledger comes from live
--     capture, not from fabricated transitions.
--   * Keep the five domains in lockstep with DEMO_BRAND_PAGE_DOMAINS in
--     app/lib/demo-brand-pages.ts.
--
-- Additive and idempotent: INSERT OR IGNORE with deterministic ids means a
-- re-apply is a no-op. Rollback = DELETE WHERE capture_method = 'demo_backfill'
-- (issue rollback section). No column drop, rename, or NOT NULL is added.

INSERT OR IGNORE INTO landing_page_snapshot (
  id,
  raw_url,
  canonical_url,
  raw_headline,
  normalized_headline,
  normalized_headline_hash,
  capture_method,
  artifact_key,
  metadata_json,
  cta_text,
  price_text,
  form_present,
  ocr_text,
  translated_text,
  captured_at,
  created_at
)
VALUES
  (
    'backfill-nike-20260825',
    'https://www.nike.com/',
    'https://www.nike.com/',
    'Nike. Just Do It.',
    'nike. just do it.',
    'backfill-nike-20260825',
    'demo_backfill',
    NULL,
    '{"backfill":true,"source":"demo_brand_seed"}',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '2026-08-25T00:00:00.000Z',
    '2026-08-27T00:00:00.000Z'
  ),
  (
    'backfill-nykaa-20260825',
    'https://www.nykaa.com/',
    'https://www.nykaa.com/',
    'Nykaa. Beauty and wellness.',
    'nykaa. beauty and wellness.',
    'backfill-nykaa-20260825',
    'demo_backfill',
    NULL,
    '{"backfill":true,"source":"demo_brand_seed"}',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '2026-08-25T00:00:00.000Z',
    '2026-08-27T00:00:00.000Z'
  ),
  (
    'backfill-allbirds-20260825',
    'https://www.allbirds.com/',
    'https://www.allbirds.com/',
    'Allbirds. Comfortable, sustainable shoes.',
    'allbirds. comfortable, sustainable shoes.',
    'backfill-allbirds-20260825',
    'demo_backfill',
    NULL,
    '{"backfill":true,"source":"demo_brand_seed"}',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '2026-08-25T00:00:00.000Z',
    '2026-08-27T00:00:00.000Z'
  ),
  (
    'backfill-lenskart-20260825',
    'https://www.lenskart.com/',
    'https://www.lenskart.com/',
    'Lenskart. Eyewear for everyone.',
    'lenskart. eyewear for everyone.',
    'backfill-lenskart-20260825',
    'demo_backfill',
    NULL,
    '{"backfill":true,"source":"demo_brand_seed"}',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '2026-08-25T00:00:00.000Z',
    '2026-08-27T00:00:00.000Z'
  ),
  (
    'backfill-mamaearth-20260825',
    'https://www.mamaearth.com/',
    'https://www.mamaearth.com/',
    'Mamaearth. Toxin-free care.',
    'mamaearth. toxin-free care.',
    'backfill-mamaearth-20260825',
    'demo_backfill',
    NULL,
    '{"backfill":true,"source":"demo_brand_seed"}',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '2026-08-25T00:00:00.000Z',
    '2026-08-27T00:00:00.000Z'
  );
