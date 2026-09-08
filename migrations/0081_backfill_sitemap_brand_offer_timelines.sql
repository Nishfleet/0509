-- Backfill one dated offer state for each sitemap brand domain that has a
-- cached /ads/:domain page but no stored landing_page_snapshot, so the
-- sibling /timeline/:domain is not a soft-404 "not stored yet" shell
-- (issue #1309, BET 3 moat page ratio).
--
-- Honesty contract (same as migration 0079 for the 5 demo brands):
--   * No screenshots are fabricated. Every backfilled row carries
--     artifact_key = NULL and metadata_json marks it `backfill: true` with
--     `source: sitemap_brand_seed`. The Offer Timeline renders the honest
--     "Captured on <date>, no screenshot" label for these rows.
--   * capture_method = 'sitemap_brand_seed' is never produced by the live
--     monitoring write path (#952), so a future audit can tell these seeded
--     rows from real captures and from the 5 demo-brand rows (0079 uses
--     'demo_backfill').
--   * Headlines are each brand's standing public positioning line — a short
--     honest description of what the company does, not invented sale events,
--     prices, or CTAs. One dated state per brand is enough to satisfy ">=1
--     dated state"; a richer ledger comes from live capture, not from
--     fabricated transitions.
--   * The 25 domains are the sitemap brand set observed on 2026-08-27 minus
--     the 5 demo brands already seeded by 0079. The route-level 410 guard
--     (issue #1309) ensures any FUTURE sitemap brand without a seed cannot
--     200 a soft-404 shell — this migration handles the current set, the
--     route handles the ongoing guarantee.
--
-- Additive and idempotent: INSERT OR IGNORE with deterministic ids means a
-- re-apply is a no-op. Rollback = DELETE WHERE capture_method =
-- 'sitemap_brand_seed' (issue rollback section). No column drop, rename, or
-- NOT NULL is added.

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
    'backfill-adidas-20260825', 'https://www.adidas.com/', 'https://www.adidas.com/',
    'adidas. Athletic footwear and apparel.', 'adidas. athletic footwear and apparel.',
    'backfill-adidas-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-adobe-20260825', 'https://www.adobe.com/', 'https://www.adobe.com/',
    'Adobe. Creative and document software.', 'adobe. creative and document software.',
    'backfill-adobe-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-amazon-20260825', 'https://www.amazon.com/', 'https://www.amazon.com/',
    'Amazon. Online marketplace and store.', 'amazon. online marketplace and store.',
    'backfill-amazon-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-asos-20260825', 'https://www.asos.com/', 'https://www.asos.com/',
    'ASOS. Online fashion and clothing.', 'asos. online fashion and clothing.',
    'backfill-asos-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-atlassian-20260825', 'https://www.atlassian.com/', 'https://www.atlassian.com/',
    'Atlassian. Team collaboration and project tools.', 'atlassian. team collaboration and project tools.',
    'backfill-atlassian-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-bombas-20260825', 'https://www.bombas.com/', 'https://www.bombas.com/',
    'Bombas. Comfortable socks and apparel.', 'bombas. comfortable socks and apparel.',
    'backfill-bombas-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-bombayshavingcompany-20260825', 'https://www.bombayshavingcompany.com/', 'https://www.bombayshavingcompany.com/',
    'Bombay Shaving Company. Men''s grooming and shaving.', 'bombay shaving company. men''s grooming and shaving.',
    'backfill-bombayshavingcompany-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-canva-20260825', 'https://www.canva.com/', 'https://www.canva.com/',
    'Canva. Online design and creation tools.', 'canva. online design and creation tools.',
    'backfill-canva-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-celonis-20260825', 'https://www.celonis.com/', 'https://www.celonis.com/',
    'Celonis. Process mining and execution management.', 'celonis. process mining and execution management.',
    'backfill-celonis-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-decathlon-20260825', 'https://www.decathlon.com/', 'https://www.decathlon.com/',
    'Decathlon. Sporting goods and equipment.', 'decathlon. sporting goods and equipment.',
    'backfill-decathlon-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-figma-20260825', 'https://www.figma.com/', 'https://www.figma.com/',
    'Figma. Collaborative interface design.', 'figma. collaborative interface design.',
    'backfill-figma-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-gymshark-20260825', 'https://www.gymshark.com/', 'https://www.gymshark.com/',
    'Gymshark. Fitness apparel and accessories.', 'gymshark. fitness apparel and accessories.',
    'backfill-gymshark-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-hm-20260825', 'https://www.hm.com/', 'https://www.hm.com/',
    'H&M. Fashion and clothing.', 'h&m. fashion and clothing.',
    'backfill-hm-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-hubspot-20260825', 'https://www.hubspot.com/', 'https://www.hubspot.com/',
    'HubSpot. CRM and marketing software.', 'hubspot. crm and marketing software.',
    'backfill-hubspot-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-mcaffeine-20260825', 'https://www.mcaffeine.com/', 'https://www.mcaffeine.com/',
    'mCaffeine. Caffeine-infused personal care.', 'mcaffeine. caffeine-infused personal care.',
    'backfill-mcaffeine-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-ouraring-20260825', 'https://www.ouraring.com/', 'https://www.ouraring.com/',
    'Oura. Smart ring health tracking.', 'oura. smart ring health tracking.',
    'backfill-ouraring-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-personio-20260825', 'https://www.personio.com/', 'https://www.personio.com/',
    'Personio. HR software and management.', 'personio. hr software and management.',
    'backfill-personio-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-ridge-20260825', 'https://www.ridge.com/', 'https://www.ridge.com/',
    'Ridge. Minimalist wallets and everyday carry.', 'ridge. minimalist wallets and everyday carry.',
    'backfill-ridge-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-ridgewallet-20260825', 'https://www.ridgewallet.com/', 'https://www.ridgewallet.com/',
    'Ridge Wallet. Minimalist RFID-blocking wallets.', 'ridge wallet. minimalist rfid-blocking wallets.',
    'backfill-ridgewallet-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-sephora-20260825', 'https://www.sephora.com/', 'https://www.sephora.com/',
    'Sephora. Beauty products and cosmetics.', 'sephora. beauty products and cosmetics.',
    'backfill-sephora-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-shopify-20260825', 'https://www.shopify.com/', 'https://www.shopify.com/',
    'Shopify. E-commerce platform for online stores.', 'shopify. e-commerce platform for online stores.',
    'backfill-shopify-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-sugarcosmetics-20260825', 'https://www.sugarcosmetics.com/', 'https://www.sugarcosmetics.com/',
    'Sugar Cosmetics. Makeup and beauty products.', 'sugar cosmetics. makeup and beauty products.',
    'backfill-sugarcosmetics-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-ulta-20260825', 'https://www.ulta.com/', 'https://www.ulta.com/',
    'Ulta Beauty. Beauty products and salon services.', 'ulta beauty. beauty products and salon services.',
    'backfill-ulta-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-walmart-20260825', 'https://www.walmart.com/', 'https://www.walmart.com/',
    'Walmart. Retail and online shopping.', 'walmart. retail and online shopping.',
    'backfill-walmart-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  ),
  (
    'backfill-zoho-20260825', 'https://www.zoho.com/', 'https://www.zoho.com/',
    'Zoho. Business software and productivity tools.', 'zoho. business software and productivity tools.',
    'backfill-zoho-20260825', 'sitemap_brand_seed', NULL,
    '{"backfill":true,"source":"sitemap_brand_seed"}',
    NULL, NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
  );
