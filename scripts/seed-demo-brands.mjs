#!/usr/bin/env node
// scripts/seed-demo-brands.mjs
//
// Holds the demo-brand and sitemap-brand seed rows that migrations 0079 and
// 0081 originally baked into the schema migration chain (issue #2344).  Prod
// already applied those migrations, so the files stay in the chain byte-for-
// byte — but every fresh D1 built by `tests/integration/apply-migrations.ts`
// now skips them by name, keeping integration-test DBs schema-only.
//
// Run this script to seed a database that was built from the schema-only
// migration set (local dev, staging, or a fresh integration-test DB):
//
//   node scripts/seed-demo-brands.mjs --local
//   node scripts/seed-demo-brands.mjs --remote
//
// The SQL below is the exact INSERT from each migration, exported so the
// integration tests can drive it onto local D1 without re-applying the
// migration.

import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Migration 0079 — 5 flagship demo brands (capture_method = 'demo_backfill')
// ---------------------------------------------------------------------------

export const DEMO_BRAND_SEED_SQL = `INSERT OR IGNORE INTO landing_page_snapshot (
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
  );`;

// ---------------------------------------------------------------------------
// Migration 0081 — 25 sitemap brands (capture_method = 'sitemap_brand_seed')
// ---------------------------------------------------------------------------

export const SITEMAP_BRAND_SEED_SQL = `INSERT OR IGNORE INTO landing_page_snapshot (
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
  );`;

// ---------------------------------------------------------------------------
// CLI runbook — apply both seeds to a D1 database via wrangler
// ---------------------------------------------------------------------------

const DATABASE_NAME = "0509";

/**
 * Apply a seed SQL script to the 0509 D1 database via `wrangler d1 execute`.
 *
 * @param {string} sql full executable SQL to run against the database
 * @param {"local" | "remote"} target which D1 environment to target
 */
function runWranglerD1(sql, target) {
  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", DATABASE_NAME, `--${target}`, "--command", sql],
    { encoding: "utf8" },
  );
  if (result.error) {
    throw new Error(`wrangler d1 execute could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || "").trim();
    throw new Error(`wrangler d1 execute failed${msg ? `: ${msg}` : ""}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const target = args.includes("--remote") ? "remote" : "local";

  console.log(`Seeding demo + sitemap brands into ${target} D1 (${DATABASE_NAME})…`);
  runWranglerD1(DEMO_BRAND_SEED_SQL, target);
  console.log("  5 demo-brand rows seeded (capture_method = demo_backfill).");
  runWranglerD1(SITEMAP_BRAND_SEED_SQL, target);
  console.log("  25 sitemap-brand rows seeded (capture_method = sitemap_brand_seed).");
  console.log("Done.");
}

// Run only when invoked directly, not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
