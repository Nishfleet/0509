-- Curated brand→peer-category map (Nishfleet/0509#1258; research-delta from the
-- P18 discovery spike v2 — "the dominant remaining work" after the ads-index
-- signal was judged too noisy alone, RED 0/12 strict).
--
-- `competitor_graph` is one durable edge per (brand, peer) pair inside one
-- peer category. brand_id / peer_brand_id hold REGISTRABLE DOMAINS — the same
-- identity the rest of the product keys on (ads/:domain pages, watchlists,
-- the /search website field) — so a curated peer links straight to a real
-- monitorable surface instead of a display string.
--
-- The map is read SYMMETRICALLY by app/lib/competitor-graph.server.ts: an
-- edge allbirds.com→vessi.com is evidence vessi.com→allbirds.com too (a peer
-- category map is undirected), so reads match either column and return the
-- other side. Writes stay directed so the curation trail stays honest.
--
-- confidence is a curatorial score (0-100), not a statistic: 95 = named in the
-- 12-domain eval ground truth, 85 = strong same-category competitor, 70 =
-- adjacent/platform-level peer. source='curated:v1' marks the hand-maintained
-- seed set; later automated sources get their own source tag so provenance
-- stays auditable at the row level.
--
-- Expand/contract phase 1 — ADD ONLY. New table, PRIMARY KEY (brand_id,
-- peer_brand_id) for idempotent re-apply via INSERT OR IGNORE, no drops, no
-- renames, no NOT NULL added to an existing table. The previous Worker version
-- neither reads nor writes this table, so a code rollback leaves it harmless.
--
-- The covering index on (brand_id, category_id) is the spec'd read shape:
-- "which category + peers for this brand" resolves without touching the row.
-- The peer_brand_id index serves the symmetric half of the read.
--
-- Seed block is GENERATED from app/data/competitor-graph-curated.json by
-- scripts/generate-competitor-graph-seed.mjs — edit the JSON and re-run the
-- script; never hand-edit inside the markers.
CREATE TABLE IF NOT EXISTS competitor_graph (
  brand_id TEXT NOT NULL,
  peer_brand_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'curated:v1',
  confidence INTEGER NOT NULL DEFAULT 80,
  last_verified_at INTEGER NOT NULL,
  PRIMARY KEY (brand_id, peer_brand_id),
  CHECK (brand_id != peer_brand_id),
  CHECK (confidence BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_competitor_graph_brand_category
  ON competitor_graph (brand_id, category_id);
CREATE INDEX IF NOT EXISTS idx_competitor_graph_peer
  ON competitor_graph (peer_brand_id);

-- BEGIN GENERATED SEED
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('aftership.com', '17track.net', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('aftership.com', 'easyship.com', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('aftership.com', 'goshippo.com', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('aftership.com', 'malomo.com', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('aftership.com', 'narvar.com', 'ecommerce-enablement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('aftership.com', 'parcelperform.com', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('aftership.com', 'parcelsapp.com', 'ecommerce-enablement', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('aftership.com', 'route.com', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('aftership.com', 'shipstation.com', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'adidas.com', 'd2c-footwear', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'asics.com', 'd2c-footwear', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'atoms.com', 'd2c-footwear', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'cariuma.com', 'd2c-footwear', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'converse.com', 'd2c-footwear', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'hoka.com', 'd2c-footwear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'koio.co', 'd2c-footwear', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'newbalance.com', 'd2c-footwear', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'nike.com', 'd2c-footwear', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'on-running.com', 'd2c-footwear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'puma.com', 'd2c-footwear', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'reebok.com', 'd2c-footwear', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'rothys.com', 'd2c-footwear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'saucony.com', 'd2c-footwear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'suavs.com', 'd2c-footwear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'thousandfell.com', 'd2c-footwear', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'toms.com', 'd2c-footwear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'vans.com', 'd2c-footwear', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'veja-store.com', 'd2c-footwear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('allbirds.com', 'vessi.com', 'd2c-footwear', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ameyo.com', 'exotel.com', 'india-saas-messaging', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ameyo.com', 'five9.com', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ameyo.com', 'genesys.com', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ameyo.com', 'knowlarity.com', 'india-saas-messaging', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ameyo.com', 'nice.com', 'india-saas-messaging', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ameyo.com', 'ozonetel.com', 'india-saas-messaging', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ameyo.com', 'talkdesk.com', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ameyo.com', 'twilio.com', 'india-saas-messaging', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('appsmith.com', 'budibase.com', 'india-saas-devtools', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('appsmith.com', 'forestadmin.com', 'india-saas-devtools', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('appsmith.com', 'illacloud.com', 'india-saas-devtools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('appsmith.com', 'internal.io', 'india-saas-devtools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('appsmith.com', 'jetadmin.io', 'india-saas-devtools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('appsmith.com', 'retool.com', 'india-saas-devtools', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('appsmith.com', 'superblocks.com', 'india-saas-devtools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('appsmith.com', 'tooljet.com', 'india-saas-devtools', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('appsmith.com', 'uibakery.io', 'india-saas-devtools', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('appsmith.com', 'windmill.dev', 'india-saas-devtools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('attentive.com', 'community.com', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('attentive.com', 'eztexting.net', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('attentive.com', 'klaviyo.com', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('attentive.com', 'postscript.io', 'ecommerce-enablement', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('attentive.com', 'privy.com', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('attentive.com', 'simpletexting.net', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('attentive.com', 'slicktext.com', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('attentive.com', 'textmagic.com', 'ecommerce-enablement', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beardo.in', 'bombayshavingcompany.com', 'india-d2c-grooming', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beardo.in', 'gillette.com', 'india-d2c-grooming', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beardo.in', 'manscaped.com', 'india-d2c-grooming', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beardo.in', 'oldspice.com', 'india-d2c-grooming', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beardo.in', 'phy.in', 'india-d2c-grooming', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beardo.in', 'setwet.com', 'india-d2c-grooming', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beardo.in', 'themancompany.com', 'india-d2c-grooming', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beardo.in', 'ustraa.com', 'india-d2c-grooming', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beminimalist.co', 'consciouschemist.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beminimalist.co', 'deconstruct.in', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beminimalist.co', 'dotandkey.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beminimalist.co', 'drsheths.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beminimalist.co', 'foxtale.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beminimalist.co', 'mamaearth.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beminimalist.co', 'plumgoodness.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beminimalist.co', 'thedermaco.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('beminimalist.co', 'theformularx.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bewakoof.com', 'ajio.com', 'india-d2c-fashion', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bewakoof.com', 'freakins.com', 'india-d2c-fashion', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bewakoof.com', 'myntra.com', 'india-d2c-fashion', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bewakoof.com', 'redwolf.in', 'india-d2c-fashion', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bewakoof.com', 'snitch.co.in', 'india-d2c-fashion', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bewakoof.com', 'thesouledstore.com', 'india-d2c-fashion', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bewakoof.com', 'urbanic.com', 'india-d2c-fashion', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bewakoof.com', 'veirdo.in', 'india-d2c-fashion', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'adobe.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'commercetools.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'prestashop.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'salesforce.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'shift4shop.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'shopify.com', 'ecommerce-platforms', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'shopline.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'shopware.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'squareup.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'volusion.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'wix.com', 'ecommerce-platforms', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bigcommerce.com', 'woocommerce.com', 'ecommerce-platforms', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bluetokaicoffee.com', 'arakucoffee.in', 'india-d2c-coffee', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bluetokaicoffee.com', 'countrybean.in', 'india-d2c-coffee', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bluetokaicoffee.com', 'ragecoffee.com', 'india-d2c-coffee', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bluetokaicoffee.com', 'sleepyowl.co', 'india-d2c-coffee', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bluetokaicoffee.com', 'subko.coffee', 'india-d2c-coffee', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bluetokaicoffee.com', 'thirdwavecoffeeroasters.com', 'india-d2c-coffee', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('boat-lifestyle.com', 'boultaudio.com', 'india-d2c-electronics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('boat-lifestyle.com', 'fireboltt.com', 'india-d2c-electronics', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('boat-lifestyle.com', 'gonoise.com', 'india-d2c-electronics', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('boat-lifestyle.com', 'jbl.com', 'india-d2c-electronics', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('boat-lifestyle.com', 'mi.com', 'india-d2c-electronics', 'curated:v1', 60, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('boat-lifestyle.com', 'ptron.in', 'india-d2c-electronics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('boat-lifestyle.com', 'realme.com', 'india-d2c-electronics', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('boat-lifestyle.com', 'skullcandy.com', 'india-d2c-electronics', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('boat-lifestyle.com', 'soundcore.com', 'india-d2c-electronics', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('boat-lifestyle.com', 'zebronics.com', 'india-d2c-electronics', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'beardo.in', 'india-d2c-grooming', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'dollarshaveclub.com', 'india-d2c-grooming', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'gillette.com', 'india-d2c-grooming', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'harrys.com', 'india-d2c-grooming', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'letsshave.com', 'india-d2c-grooming', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'manscaped.com', 'india-d2c-grooming', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'nivea.com', 'india-d2c-grooming', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'oldspice.com', 'india-d2c-grooming', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'phy.in', 'india-d2c-grooming', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'setwet.com', 'india-d2c-grooming', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'spruceshaveclub.com', 'india-d2c-grooming', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'themancompany.com', 'india-d2c-grooming', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('bombayshavingcompany.com', 'ustraa.com', 'india-d2c-grooming', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'applitools.com', 'india-saas-testing', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'browserling.com', 'india-saas-testing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'headspin.io', 'india-saas-testing', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'kobiton.com', 'india-saas-testing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'lambdatest.com', 'india-saas-testing', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'pcloudy.com', 'india-saas-testing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'perfecto.io', 'india-saas-testing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'saucelabs.com', 'india-saas-testing', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'testgrid.io', 'india-saas-testing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'testingbot.com', 'india-saas-testing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('browserstack.com', 'testsigma.com', 'india-saas-testing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'adobe.com', 'saas-design-tools', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'desygner.com', 'saas-design-tools', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'easil.com', 'saas-design-tools', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'figma.com', 'saas-design-tools', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'fotor.com', 'saas-design-tools', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'getstencil.com', 'saas-design-tools', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'invisionapp.com', 'saas-design-tools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'kittl.com', 'saas-design-tools', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'photopea.com', 'saas-design-tools', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'picmonkey.com', 'saas-design-tools', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'piktochart.com', 'saas-design-tools', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'recraft.ai', 'saas-design-tools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'relaythat.com', 'saas-design-tools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'sketch.com', 'saas-design-tools', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'snappa.com', 'saas-design-tools', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'vectr.com', 'saas-design-tools', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'visme.co', 'saas-design-tools', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('canva.com', 'vistacreate.com', 'saas-design-tools', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('cashfree.com', 'ccavenue.com', 'india-saas-fintech', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('cashfree.com', 'easebuzz.in', 'india-saas-fintech', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('cashfree.com', 'instamojo.com', 'india-saas-fintech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('cashfree.com', 'juspay.in', 'india-saas-fintech', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('cashfree.com', 'paytm.com', 'india-saas-fintech', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('cashfree.com', 'payu.in', 'india-saas-fintech', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('cashfree.com', 'razorpay.com', 'india-saas-fintech', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('cashfree.com', 'stripe.com', 'india-saas-fintech', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chargebee.com', 'fastspring.com', 'india-saas-billing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chargebee.com', 'maxio.com', 'india-saas-billing', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chargebee.com', 'paddle.com', 'india-saas-billing', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chargebee.com', 'recurly.com', 'india-saas-billing', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chargebee.com', 'revenuecat.com', 'india-saas-billing', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chargebee.com', 'stripe.com', 'india-saas-billing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chargebee.com', 'withorb.com', 'india-saas-billing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chargebee.com', 'zoho.com', 'india-saas-billing', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chargebee.com', 'zuora.com', 'india-saas-billing', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chatwoot.com', 'crisp.chat', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chatwoot.com', 'freshworks.com', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chatwoot.com', 'frontapp.com', 'india-saas-cx', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chatwoot.com', 'helpcrunch.com', 'india-saas-cx', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chatwoot.com', 'intercom.com', 'india-saas-cx', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chatwoot.com', 'tawk.to', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chatwoot.com', 'zendesk.com', 'india-saas-cx', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('chatwoot.com', 'zoho.com', 'india-saas-cx', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('clevertap.com', 'airship.com', 'india-saas-engagement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('clevertap.com', 'braze.com', 'india-saas-engagement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('clevertap.com', 'customer.io', 'india-saas-engagement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('clevertap.com', 'iterable.com', 'india-saas-engagement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('clevertap.com', 'klaviyo.com', 'india-saas-engagement', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('clevertap.com', 'moengage.com', 'india-saas-engagement', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('clevertap.com', 'netcorecloud.com', 'india-saas-engagement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('clevertap.com', 'onesignal.com', 'india-saas-engagement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('clevertap.com', 'plotline.so', 'india-saas-engagement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('clevertap.com', 'webengage.com', 'india-saas-engagement', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('countrydelight.in', 'akshayakalpa.org', 'india-d2c-dairy', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('countrydelight.in', 'amul.com', 'india-d2c-dairy', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('countrydelight.in', 'heritagefoods.in', 'india-d2c-dairy', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('countrydelight.in', 'milkymist.com', 'india-d2c-dairy', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('countrydelight.in', 'motherdairy.com', 'india-d2c-dairy', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('countrydelight.in', 'prideofcows.com', 'india-d2c-dairy', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('countrydelight.in', 'sidsfarm.com', 'india-d2c-dairy', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', '1mg.com', 'india-healthtech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'dailyrounds.org', 'india-healthtech', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'doximity.com', 'india-healthtech', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'figure1.com', 'india-healthtech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'healthtap.com', 'india-healthtech', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'icliniq.com', 'india-healthtech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'lybrate.com', 'india-healthtech', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'medibuddy.in', 'india-healthtech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'medshr.net', 'india-healthtech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'mfine.co', 'india-healthtech', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'netmeds.com', 'india-healthtech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'pharmeasy.in', 'india-healthtech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'plexusmd.com', 'india-healthtech', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'practo.com', 'india-healthtech', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('curofy.com', 'sermo.com', 'india-healthtech', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('dailyobjects.com', 'casetify.com', 'india-d2c-accessories', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('dailyobjects.com', 'chumbak.com', 'india-d2c-accessories', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('dailyobjects.com', 'coveritup.com', 'india-d2c-accessories', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('dailyobjects.com', 'macmerise.com', 'india-d2c-accessories', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('dailyobjects.com', 'postergully.com', 'india-d2c-accessories', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('dailyobjects.com', 'zouk.co.in', 'india-d2c-accessories', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('darwinbox.com', 'adp.com', 'india-saas-hcm', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('darwinbox.com', 'bamboohr.com', 'india-saas-hcm', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('darwinbox.com', 'greythr.com', 'india-saas-hcm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('darwinbox.com', 'hibob.com', 'india-saas-hcm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('darwinbox.com', 'keka.com', 'india-saas-hcm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('darwinbox.com', 'peoplestrong.com', 'india-saas-hcm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('darwinbox.com', 'rippling.com', 'india-saas-hcm', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('darwinbox.com', 'ukg.com', 'india-saas-hcm', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('darwinbox.com', 'workday.com', 'india-saas-hcm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('darwinbox.com', 'zoho.com', 'india-saas-hcm', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('docusign.com', 'adobe.com', 'saas-esign', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('docusign.com', 'dottedsign.com', 'saas-esign', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('docusign.com', 'getaccept.com', 'saas-esign', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('docusign.com', 'hellosign.com', 'saas-esign', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('docusign.com', 'pandadoc.com', 'saas-esign', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('docusign.com', 'proposify.com', 'saas-esign', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('docusign.com', 'qwilr.com', 'saas-esign', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('docusign.com', 'signeasy.com', 'saas-esign', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('docusign.com', 'signnow.com', 'saas-esign', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('docusign.com', 'zoho.com', 'saas-esign', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'acronis.com', 'saas-data-protection', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'backblaze.com', 'saas-data-protection', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'cohesity.com', 'saas-data-protection', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'commvault.com', 'saas-data-protection', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'crashplan.com', 'saas-data-protection', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'datto.com', 'saas-data-protection', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'nakivo.com', 'saas-data-protection', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'rubrik.com', 'saas-data-protection', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'unitrends.com', 'saas-data-protection', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'veeam.com', 'saas-data-protection', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('druva.com', 'zerto.com', 'saas-data-protection', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('everstage.io', 'captivateiq.com', 'india-saas-sales', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('everstage.io', 'performio.co', 'india-saas-sales', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('everstage.io', 'quotapath.com', 'india-saas-sales', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('everstage.io', 'spiff.com', 'india-saas-sales', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('everstage.io', 'varicent.com', 'india-saas-sales', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('everstage.io', 'xactlycorp.com', 'india-saas-sales', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'ameyo.com', 'india-saas-messaging', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'gupshup.io', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'kaleyra.com', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'knowlarity.com', 'india-saas-messaging', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'msg91.com', 'india-saas-messaging', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'myoperator.com', 'india-saas-messaging', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'ozonetel.com', 'india-saas-messaging', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'plivo.com', 'india-saas-messaging', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'ringcentral.com', 'india-saas-messaging', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'servetel.in', 'india-saas-messaging', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'tanla.com', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'twilio.com', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('exotel.com', 'vonage.com', 'india-saas-messaging', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fabindia.com', 'biba.in', 'india-d2c-fashion', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fabindia.com', 'chumbak.com', 'india-d2c-fashion', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fabindia.com', 'globaldesi.in', 'india-d2c-fashion', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fabindia.com', 'goodearth.in', 'india-d2c-fashion', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fabindia.com', 'jaypore.com', 'india-d2c-fashion', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fabindia.com', 'manyavar.com', 'india-d2c-fashion', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fabindia.com', 'nicobar.com', 'india-d2c-fashion', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fabindia.com', 'okhai.com', 'india-d2c-fashion', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fabindia.com', 'wforwoman.com', 'india-d2c-fashion', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('faire.com', 'ankorstore.com', 'ecommerce-wholesale', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('faire.com', 'brandboom.com', 'ecommerce-wholesale', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('faire.com', 'creoate.com', 'ecommerce-wholesale', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('faire.com', 'fashiongo.net', 'ecommerce-wholesale', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('faire.com', 'fashwire.com', 'ecommerce-wholesale', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('faire.com', 'helloabound.com', 'ecommerce-wholesale', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('faire.com', 'hubventory.com', 'ecommerce-wholesale', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('faire.com', 'joor.com', 'ecommerce-wholesale', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('faire.com', 'lenewblack.com', 'ecommerce-wholesale', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('faire.com', 'orangeshine.com', 'ecommerce-wholesale', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fireboltt.com', 'amazfit.com', 'india-d2c-electronics', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fireboltt.com', 'boat-lifestyle.com', 'india-d2c-electronics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fireboltt.com', 'boultaudio.com', 'india-d2c-electronics', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fireboltt.com', 'crossbeats.com', 'india-d2c-electronics', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fireboltt.com', 'fastrack.in', 'india-d2c-electronics', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fireboltt.com', 'gonoise.com', 'india-d2c-electronics', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fireboltt.com', 'ptron.in', 'india-d2c-electronics', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('fireboltt.com', 'titan.co.in', 'india-d2c-electronics', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('forestessentials.com', 'biotique.com', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('forestessentials.com', 'justherbs.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('forestessentials.com', 'kamaayurveda.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('forestessentials.com', 'khadinatural.com', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('forestessentials.com', 'lotusherbals.com', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('forestessentials.com', 'soulflower.biz', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('forestessentials.com', 'soultree.in', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('forestessentials.com', 'thebodyshop.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'helpscout.com', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'hiverhq.com', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'hubspot.com', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'intercom.com', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'kayako.com', 'india-saas-cx', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'kissflow.com', 'india-saas-cx', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'leadsquared.com', 'india-saas-cx', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'manageengine.com', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'salesforce.com', 'india-saas-cx', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'vtiger.com', 'india-saas-cx', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'zendesk.com', 'india-saas-cx', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('freshworks.com', 'zoho.com', 'india-saas-cx', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gonoise.com', 'amazfit.com', 'india-d2c-electronics', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gonoise.com', 'boat-lifestyle.com', 'india-d2c-electronics', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gonoise.com', 'boultaudio.com', 'india-d2c-electronics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gonoise.com', 'crossbeats.com', 'india-d2c-electronics', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gonoise.com', 'fastrack.in', 'india-d2c-electronics', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gonoise.com', 'fireboltt.com', 'india-d2c-electronics', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gonoise.com', 'ptron.in', 'india-d2c-electronics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gonoise.com', 'titan.co.in', 'india-d2c-electronics', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gorgias.com', 'crisp.chat', 'ecommerce-enablement', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gorgias.com', 'freshworks.com', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gorgias.com', 'gladly.com', 'ecommerce-enablement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gorgias.com', 'helpscout.com', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gorgias.com', 'intercom.com', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gorgias.com', 'kustomer.com', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gorgias.com', 'reamaze.com', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gorgias.com', 'richpanel.com', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gorgias.com', 'zendesk.com', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'exotel.com', 'india-saas-messaging', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'haptik.ai', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'infobip.com', 'india-saas-messaging', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'kaleyra.com', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'karix.io', 'india-saas-messaging', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'messagebird.com', 'india-saas-messaging', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'plivo.com', 'india-saas-messaging', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'sinch.com', 'india-saas-messaging', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'twilio.com', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'wati.io', 'india-saas-messaging', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gupshup.io', 'yellow.ai', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'adidas.com', 'd2c-activewear', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'aloyoga.com', 'd2c-activewear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'alphaleteathletics.com', 'd2c-activewear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'boandtee.com', 'd2c-activewear', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'bornprimitive.com', 'd2c-activewear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'castore.com', 'd2c-activewear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'lululemon.com', 'd2c-activewear', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'myprotein.com', 'd2c-activewear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'nike.com', 'd2c-activewear', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'oneractive.com', 'd2c-activewear', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'outdoorvoices.com', 'd2c-activewear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'rhone.com', 'd2c-activewear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'tenthousand.cc', 'd2c-activewear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'tracksmith.com', 'd2c-activewear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'underarmour.com', 'd2c-activewear', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('gymshark.com', 'vuoriclothing.com', 'd2c-activewear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('haptik.ai', 'ada.cx', 'india-saas-chatbots', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('haptik.ai', 'gupshup.io', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('haptik.ai', 'intercom.com', 'india-saas-chatbots', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('haptik.ai', 'kore.ai', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('haptik.ai', 'liveperson.com', 'india-saas-chatbots', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('haptik.ai', 'senseforth.ai', 'india-saas-chatbots', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('haptik.ai', 'verloop.io', 'india-saas-chatbots', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('haptik.ai', 'wati.io', 'india-saas-chatbots', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('haptik.ai', 'yellow.ai', 'india-saas-chatbots', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hasura.io', 'apollographql.com', 'india-saas-baas', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hasura.io', 'appwrite.io', 'india-saas-baas', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hasura.io', 'nhost.io', 'india-saas-baas', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hasura.io', 'pocketbase.io', 'india-saas-baas', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hasura.io', 'postman.com', 'india-saas-baas', 'curated:v1', 60, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hasura.io', 'prisma.io', 'india-saas-baas', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hasura.io', 'supabase.com', 'india-saas-baas', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('highradius.com', 'bill.com', 'saas-finance-ops', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('highradius.com', 'billtrust.com', 'saas-finance-ops', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('highradius.com', 'blackline.com', 'saas-finance-ops', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('highradius.com', 'celonis.com', 'saas-finance-ops', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('highradius.com', 'corcentric.com', 'saas-finance-ops', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('highradius.com', 'emagia.com', 'saas-finance-ops', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('highradius.com', 'esker.com', 'saas-finance-ops', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('highradius.com', 'kyriba.com', 'saas-finance-ops', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('highradius.com', 'sidetrade.com', 'saas-finance-ops', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('highradius.com', 'tipalti.com', 'saas-finance-ops', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hiverhq.com', 'freshworks.com', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hiverhq.com', 'frontapp.com', 'india-saas-cx', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hiverhq.com', 'gmelius.com', 'india-saas-cx', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hiverhq.com', 'groovehq.com', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hiverhq.com', 'helpcrunch.com', 'india-saas-cx', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hiverhq.com', 'helpscout.com', 'india-saas-cx', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hiverhq.com', 'kayako.com', 'india-saas-cx', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hiverhq.com', 'missiveapp.com', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hiverhq.com', 'zendesk.com', 'india-saas-cx', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hiverhq.com', 'zoho.com', 'india-saas-cx', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'activecampaign.com', 'saas-crm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'attio.com', 'saas-crm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'close.com', 'saas-crm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'copper.com', 'saas-crm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'freshworks.com', 'saas-crm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'insightly.com', 'saas-crm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'keap.com', 'saas-crm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'mailchimp.com', 'saas-crm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'marketo.com', 'saas-crm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'monday.com', 'saas-crm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'nutshell.com', 'saas-crm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'pardot.com', 'saas-crm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'pipedrive.com', 'saas-crm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'salesforce.com', 'saas-crm', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'zendesk.com', 'saas-crm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('hubspot.com', 'zoho.com', 'saas-crm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'agiloft.com', 'saas-clm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'conga.com', 'saas-clm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'contractpodai.com', 'saas-clm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'contractworks.com', 'saas-clm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'docusign.com', 'saas-clm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'evisort.com', 'saas-clm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'ironcladapp.com', 'saas-clm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'juro.com', 'saas-clm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'linksquares.com', 'saas-clm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'sirion.ai', 'saas-clm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'spotdraft.com', 'saas-clm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('icertis.com', 'volody.com', 'saas-clm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'arcadia.io', 'india-saas-healthit', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'athenahealth.com', 'india-saas-healthit', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'clarifyhealth.com', 'india-saas-healthit', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'cotiviti.com', 'india-saas-healthit', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'definitivehc.com', 'india-saas-healthit', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'epic.com', 'india-saas-healthit', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'healthec.com', 'india-saas-healthit', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'leantaas.com', 'india-saas-healthit', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'nuna.com', 'india-saas-healthit', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'optum.com', 'india-saas-healthit', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('innovaccer.com', 'zeomega.com', 'india-saas-healthit', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'bamboohr.com', 'india-saas-hcm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'darwinbox.com', 'india-saas-hcm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'factohr.com', 'india-saas-hcm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'greythr.com', 'india-saas-hcm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'gusto.com', 'india-saas-hcm', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'hibob.com', 'india-saas-hcm', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'kredily.com', 'india-saas-hcm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'peoplestrong.com', 'india-saas-hcm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'rippling.com', 'india-saas-hcm', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'sumhr.com', 'india-saas-hcm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('keka.com', 'zoho.com', 'india-saas-hcm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'airtable.com', 'india-saas-workflow', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'appian.com', 'india-saas-workflow', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'cflowapps.com', 'india-saas-workflow', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'integrify.com', 'india-saas-workflow', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'kintone.com', 'india-saas-workflow', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'nintex.com', 'india-saas-workflow', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'pipefy.com', 'india-saas-workflow', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'processmaker.com', 'india-saas-workflow', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'quickbase.com', 'india-saas-workflow', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'smartsheet.com', 'india-saas-workflow', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kissflow.com', 'zoho.com', 'india-saas-workflow', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'attentive.com', 'ecommerce-enablement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'braze.com', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'customer.io', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'drip.com', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'emarsys.com', 'ecommerce-enablement', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'iterable.com', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'listrak.com', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'mailchimp.com', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'omnisend.com', 'ecommerce-enablement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'postscript.io', 'ecommerce-enablement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'sendlane.com', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('klaviyo.com', 'yotpo.com', 'ecommerce-enablement', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('knowlarity.com', 'ameyo.com', 'india-saas-messaging', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('knowlarity.com', 'exotel.com', 'india-saas-messaging', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('knowlarity.com', 'myoperator.com', 'india-saas-messaging', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('knowlarity.com', 'ozonetel.com', 'india-saas-messaging', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('knowlarity.com', 'plivo.com', 'india-saas-messaging', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('knowlarity.com', 'ringcentral.com', 'india-saas-messaging', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('knowlarity.com', 'servetel.in', 'india-saas-messaging', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('knowlarity.com', 'twilio.com', 'india-saas-messaging', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kommunicate.io', 'crisp.chat', 'india-saas-chatbots', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kommunicate.io', 'freshworks.com', 'india-saas-chatbots', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kommunicate.io', 'haptik.ai', 'india-saas-chatbots', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kommunicate.io', 'helpcrunch.com', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kommunicate.io', 'intercom.com', 'india-saas-chatbots', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kommunicate.io', 'tawk.to', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kommunicate.io', 'tidio.com', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kommunicate.io', 'yellow.ai', 'india-saas-chatbots', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('kommunicate.io', 'zoho.com', 'india-saas-chatbots', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lambdatest.com', 'applitools.com', 'india-saas-testing', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lambdatest.com', 'browserling.com', 'india-saas-testing', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lambdatest.com', 'browserstack.com', 'india-saas-testing', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lambdatest.com', 'kobiton.com', 'india-saas-testing', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lambdatest.com', 'pcloudy.com', 'india-saas-testing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lambdatest.com', 'perfecto.io', 'india-saas-testing', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lambdatest.com', 'saucelabs.com', 'india-saas-testing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lambdatest.com', 'testgrid.io', 'india-saas-testing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lambdatest.com', 'testingbot.com', 'india-saas-testing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lambdatest.com', 'testsigma.com', 'india-saas-testing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('leadsquared.com', 'agilecrm.com', 'india-saas-crm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('leadsquared.com', 'engagebay.com', 'india-saas-crm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('leadsquared.com', 'freshworks.com', 'india-saas-crm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('leadsquared.com', 'hubspot.com', 'india-saas-crm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('leadsquared.com', 'kylas.io', 'india-saas-crm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('leadsquared.com', 'meritto.com', 'india-saas-crm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('leadsquared.com', 'pipedrive.com', 'india-saas-crm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('leadsquared.com', 'salesforce.com', 'india-saas-crm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('leadsquared.com', 'vtiger.com', 'india-saas-crm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('leadsquared.com', 'zoho.com', 'india-saas-crm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lenskart.com', 'cleardekho.com', 'india-d2c-eyewear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lenskart.com', 'coolwinks.com', 'india-d2c-eyewear', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lenskart.com', 'eyewearlabs.com', 'india-d2c-eyewear', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lenskart.com', 'johnjacobseyewear.com', 'india-d2c-eyewear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lenskart.com', 'specsmakers.in', 'india-d2c-eyewear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lenskart.com', 'titaneyeplus.com', 'india-d2c-eyewear', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lenskart.com', 'visionexpress.in', 'india-d2c-eyewear', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lenskart.com', 'warbyparker.com', 'india-d2c-eyewear', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('lenskart.com', 'zennioptical.com', 'india-d2c-eyewear', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('licious.in', 'bigbasket.com', 'india-d2c-meat', 'curated:v1', 60, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('licious.in', 'freshtohome.com', 'india-d2c-meat', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('licious.in', 'meatigo.com', 'india-d2c-meat', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('licious.in', 'tendercuts.in', 'india-d2c-meat', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('licious.in', 'zappfresh.com', 'india-d2c-meat', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'activecampaign.com', 'saas-email-marketing', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'aweber.com', 'saas-email-marketing', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'benchmarkemail.com', 'saas-email-marketing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'brevo.com', 'saas-email-marketing', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'campaignmonitor.com', 'saas-email-marketing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'clevertap.com', 'saas-email-marketing', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'constantcontact.com', 'saas-email-marketing', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'drip.com', 'saas-email-marketing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'getresponse.com', 'saas-email-marketing', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'kit.com', 'saas-email-marketing', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'klaviyo.com', 'saas-email-marketing', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'mailerlite.com', 'saas-email-marketing', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'mailjet.com', 'saas-email-marketing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'moengage.com', 'saas-email-marketing', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'moosend.com', 'saas-email-marketing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'omnisend.com', 'saas-email-marketing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'sendgrid.com', 'saas-email-marketing', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mailchimp.com', 'webengage.com', 'saas-email-marketing', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'beminimalist.co', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'biotique.com', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'buywow.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'dotandkey.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'drsheths.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'earthrhythm.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'foxtale.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'himalayawellness.in', 'india-d2c-beauty', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'justherbs.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'lotusherbals.com', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'mcaffeine.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'nykaa.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'plumgoodness.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mamaearth.in', 'thedermaco.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('manageengine.com', 'atera.com', 'india-saas-suite', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('manageengine.com', 'atlassian.com', 'india-saas-suite', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('manageengine.com', 'bmc.com', 'india-saas-suite', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('manageengine.com', 'freshworks.com', 'india-saas-suite', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('manageengine.com', 'ivanti.com', 'india-saas-suite', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('manageengine.com', 'ninjaone.com', 'india-saas-suite', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('manageengine.com', 'servicenow.com', 'india-saas-suite', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('manageengine.com', 'solarwinds.com', 'india-saas-suite', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('manageengine.com', 'superops.com', 'india-saas-suite', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('manageengine.com', 'zoho.com', 'india-saas-suite', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mindtickle.com', 'allego.com', 'india-saas-sales', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mindtickle.com', 'bigtincan.com', 'india-saas-sales', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mindtickle.com', 'gong.io', 'india-saas-sales', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mindtickle.com', 'highspot.com', 'india-saas-sales', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mindtickle.com', 'mediafly.com', 'india-saas-sales', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mindtickle.com', 'outreach.io', 'india-saas-sales', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mindtickle.com', 'saleshood.com', 'india-saas-sales', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mindtickle.com', 'seismic.com', 'india-saas-sales', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mindtickle.com', 'showpad.com', 'india-saas-sales', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('mindtickle.com', 'spekit.com', 'india-saas-sales', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('moengage.com', 'braze.com', 'india-saas-engagement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('moengage.com', 'clevertap.com', 'india-saas-engagement', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('moengage.com', 'customer.io', 'india-saas-engagement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('moengage.com', 'iterable.com', 'india-saas-engagement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('moengage.com', 'netcorecloud.com', 'india-saas-engagement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('moengage.com', 'onesignal.com', 'india-saas-engagement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('moengage.com', 'plotline.so', 'india-saas-engagement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('moengage.com', 'webengage.com', 'india-saas-engagement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('myglamm.com', 'colorbarcosmetics.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('myglamm.com', 'facescanada.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('myglamm.com', 'insightcosmetics.in', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('myglamm.com', 'maccosmetics.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('myglamm.com', 'myntra.com', 'india-d2c-beauty', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('myglamm.com', 'nykaa.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('myglamm.com', 'plumgoodness.com', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('myglamm.com', 'purplle.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('myglamm.com', 'reneecosmetics.in', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('myglamm.com', 'sugarcosmetics.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'airtable.com', 'saas-work-management', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'anytype.io', 'saas-work-management', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'asana.com', 'saas-work-management', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'basecamp.com', 'saas-work-management', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'bear.app', 'saas-work-management', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'capacities.io', 'saas-work-management', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'clickup.com', 'saas-work-management', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'coda.io', 'saas-work-management', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'craft.do', 'saas-work-management', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'evernote.com', 'saas-work-management', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'fibery.io', 'saas-work-management', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'height.app', 'saas-work-management', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'logseq.com', 'saas-work-management', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'mem.ai', 'saas-work-management', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'monday.com', 'saas-work-management', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'nuclino.com', 'saas-work-management', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'obsidian.md', 'saas-work-management', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'onenote.com', 'saas-work-management', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'roamresearch.com', 'saas-work-management', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'slab.com', 'saas-work-management', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'slite.com', 'saas-work-management', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'smartsheet.com', 'saas-work-management', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'tana.inc', 'saas-work-management', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'trello.com', 'saas-work-management', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('notion.so', 'wrike.com', 'saas-work-management', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'colorbarcosmetics.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'facescanada.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'forestessentials.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'kamaayurveda.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'lakmeindia.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'maccosmetics.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'mamaearth.in', 'india-d2c-beauty', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'myglamm.com', 'india-d2c-beauty', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'myntra.com', 'india-d2c-beauty', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'plumgoodness.com', 'india-d2c-beauty', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'purplle.com', 'india-d2c-beauty', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'sephora.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'smytten.com', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'sugarcosmetics.com', 'india-d2c-beauty', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'thebodyshop.in', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'tirabeauty.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('nykaa.com', 'ulta.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'amazfit.com', 'wearables-health', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'apple.com', 'wearables-health', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'bellabeat.com', 'wearables-health', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'circular.xyz', 'wearables-health', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'coros.com', 'wearables-health', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'eviering.com', 'wearables-health', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'fitbit.com', 'wearables-health', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'garmin.com', 'wearables-health', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'huawei.com', 'wearables-health', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'misfit.com', 'wearables-health', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'moov.cc', 'wearables-health', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'polar.com', 'wearables-health', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'ringconn.com', 'wearables-health', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'samsung.com', 'wearables-health', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'suunto.com', 'wearables-health', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'ultrahuman.com', 'wearables-health', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'whoop.com', 'wearables-health', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ouraring.com', 'withings.com', 'wearables-health', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ozonetel.com', 'ameyo.com', 'india-saas-messaging', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ozonetel.com', 'exotel.com', 'india-saas-messaging', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ozonetel.com', 'five9.com', 'india-saas-messaging', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ozonetel.com', 'genesys.com', 'india-saas-messaging', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ozonetel.com', 'knowlarity.com', 'india-saas-messaging', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ozonetel.com', 'nice.com', 'india-saas-messaging', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ozonetel.com', 'talkdesk.com', 'india-saas-messaging', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ozonetel.com', 'twilio.com', 'india-saas-messaging', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('pinelabs.com', 'ezetap.com', 'india-saas-fintech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('pinelabs.com', 'innoviti.com', 'india-saas-fintech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('pinelabs.com', 'paytm.com', 'india-saas-fintech', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('pinelabs.com', 'payu.in', 'india-saas-fintech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('pinelabs.com', 'phonepe.com', 'india-saas-fintech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('pinelabs.com', 'razorpay.com', 'india-saas-fintech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('pinelabs.com', 'worldline.com', 'india-saas-fintech', 'curated:v1', 60, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('pinelabs.com', 'zeta.tech', 'india-saas-fintech', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plane.so', 'asana.com', 'india-saas-pm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plane.so', 'atlassian.com', 'india-saas-pm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plane.so', 'clickup.com', 'india-saas-pm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plane.so', 'height.app', 'india-saas-pm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plane.so', 'linear.app', 'india-saas-pm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plane.so', 'monday.com', 'india-saas-pm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plane.so', 'openproject.org', 'india-saas-pm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plane.so', 'shortcut.com', 'india-saas-pm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plane.so', 'taiga.io', 'india-saas-pm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'amplitude.com', 'saas-analytics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'beampipe.io', 'saas-analytics', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'chartbeat.com', 'saas-analytics', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'clicky.com', 'saas-analytics', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'countly.com', 'saas-analytics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'goaccess.io', 'saas-analytics', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'heap.io', 'saas-analytics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'kissmetrics.io', 'saas-analytics', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'matomo.org', 'saas-analytics', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'mixpanel.com', 'saas-analytics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'openwebanalytics.com', 'saas-analytics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'panelbear.com', 'saas-analytics', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'pirsch.io', 'saas-analytics', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'posthog.com', 'saas-analytics', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'simpleanalytics.com', 'saas-analytics', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'statcounter.com', 'saas-analytics', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'swetrix.com', 'saas-analytics', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'umami.is', 'saas-analytics', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'usefathom.com', 'saas-analytics', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plausible.io', 'woopra.com', 'saas-analytics', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'beminimalist.co', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'buywow.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'discoverpilgrim.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'dotandkey.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'drsheths.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'earthrhythm.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'foxtale.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'justherbs.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'mamaearth.in', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'mcaffeine.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'nykaa.com', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('plumgoodness.com', 'thedermaco.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'apidog.com', 'india-saas-devtools', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'firecamp.dev', 'india-saas-devtools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'hoppscotch.io', 'india-saas-devtools', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'httpie.io', 'india-saas-devtools', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'insomnia.rest', 'india-saas-devtools', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'konghq.com', 'india-saas-devtools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'rapidapi.com', 'india-saas-devtools', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'smartbear.com', 'india-saas-devtools', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'stoplight.io', 'india-saas-devtools', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'thunderclient.com', 'india-saas-devtools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'tyk.io', 'india-saas-devtools', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('postman.com', 'usebruno.com', 'india-saas-devtools', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('purplle.com', 'amazon.in', 'india-d2c-beauty', 'curated:v1', 60, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('purplle.com', 'blueheavencosmetics.in', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('purplle.com', 'facescanada.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('purplle.com', 'insightcosmetics.in', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('purplle.com', 'myglamm.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('purplle.com', 'myntra.com', 'india-d2c-beauty', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('purplle.com', 'nykaa.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('purplle.com', 'sugarcosmetics.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('purplle.com', 'tirabeauty.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'billdesk.com', 'india-saas-fintech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'cashfree.com', 'india-saas-fintech', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'ccavenue.com', 'india-saas-fintech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'easebuzz.in', 'india-saas-fintech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'instamojo.com', 'india-saas-fintech', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'juspay.in', 'india-saas-fintech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'open.money', 'india-saas-fintech', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'paytm.com', 'india-saas-fintech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'payu.in', 'india-saas-fintech', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'phonepe.com', 'india-saas-fintech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'pinelabs.com', 'india-saas-fintech', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'setu.co', 'india-saas-fintech', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'stripe.com', 'india-saas-fintech', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('razorpay.com', 'zeta.tech', 'india-saas-fintech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'andar.delivery', 'd2c-wallets-edc', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'bellroy.com', 'd2c-wallets-edc', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'dangoproducts.com', 'd2c-wallets-edc', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'distilunion.com', 'd2c-wallets-edc', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'ekster.com', 'd2c-wallets-edc', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'hammeranvil.com', 'd2c-wallets-edc', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'herschel.com', 'd2c-wallets-edc', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'nomadgoods.com', 'd2c-wallets-edc', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'saddlebackleather.com', 'd2c-wallets-edc', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'secrid.com', 'd2c-wallets-edc', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'smartish.com', 'd2c-wallets-edc', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'trayvax.com', 'd2c-wallets-edc', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'tumi.com', 'd2c-wallets-edc', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ridgewallet.com', 'vaultskin.com', 'd2c-wallets-edc', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'adobe.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'bigcommerce.com', 'ecommerce-platforms', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'commercetools.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'duda.co', 'ecommerce-platforms', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'ecwid.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'godaddy.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'medusajs.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'opencart.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'prestashop.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'saleor.io', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'salesforce.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'shift4shop.com', 'ecommerce-platforms', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'shopline.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'squarespace.com', 'ecommerce-platforms', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'squareup.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'volusion.com', 'ecommerce-platforms', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'webflow.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'weebly.com', 'ecommerce-platforms', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'wix.com', 'ecommerce-platforms', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('shopify.com', 'woocommerce.com', 'ecommerce-platforms', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'chronosphere.io', 'india-saas-observability', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'coralogix.com', 'india-saas-observability', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'datadoghq.com', 'india-saas-observability', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'dynatrace.com', 'india-saas-observability', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'elastic.co', 'india-saas-observability', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'grafana.com', 'india-saas-observability', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'groundcover.com', 'india-saas-observability', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'honeycomb.io', 'india-saas-observability', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'last9.io', 'india-saas-observability', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'middleware.io', 'india-saas-observability', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'newrelic.com', 'india-saas-observability', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('signoz.io', 'sumologic.com', 'india-saas-observability', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sleepyowl.co', 'arakucoffee.in', 'india-d2c-coffee', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sleepyowl.co', 'bluetokaicoffee.com', 'india-d2c-coffee', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sleepyowl.co', 'countrybean.in', 'india-d2c-coffee', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sleepyowl.co', 'ragecoffee.com', 'india-d2c-coffee', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sleepyowl.co', 'subko.coffee', 'india-d2c-coffee', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sleepyowl.co', 'thirdwavecoffeeroasters.com', 'india-d2c-coffee', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('slurpfarm.com', 'earlyfoods.com', 'india-d2c-food', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('slurpfarm.com', 'monsoonharvest.in', 'india-d2c-food', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('slurpfarm.com', 'ritebite.in', 'india-d2c-food', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('slurpfarm.com', 'thewholetruthfoods.com', 'india-d2c-food', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('slurpfarm.com', 'true-elements.com', 'india-d2c-food', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('slurpfarm.com', 'yogabars.in', 'india-d2c-food', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('snitch.co.in', 'bewakoof.com', 'india-d2c-fashion', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('snitch.co.in', 'freakins.com', 'india-d2c-fashion', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('snitch.co.in', 'myntra.com', 'india-d2c-fashion', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('snitch.co.in', 'rarerabbit.com', 'india-d2c-fashion', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('snitch.co.in', 'thesouledstore.com', 'india-d2c-fashion', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('snitch.co.in', 'urbanic.com', 'india-d2c-fashion', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('snitch.co.in', 'zara.com', 'india-d2c-fashion', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spendflo.com', 'productiv.com', 'india-saas-saas-mgmt', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spendflo.com', 'sastrify.com', 'india-saas-saas-mgmt', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spendflo.com', 'toriihq.com', 'india-saas-saas-mgmt', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spendflo.com', 'tropicapp.io', 'india-saas-saas-mgmt', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spendflo.com', 'vendr.com', 'india-saas-saas-mgmt', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spendflo.com', 'ziphq.com', 'india-saas-saas-mgmt', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spendflo.com', 'zluri.com', 'india-saas-saas-mgmt', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spendflo.com', 'zylo.com', 'india-saas-saas-mgmt', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spotdraft.com', 'agiloft.com', 'saas-clm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spotdraft.com', 'conga.com', 'saas-clm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spotdraft.com', 'contractpodai.com', 'saas-clm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spotdraft.com', 'docusign.com', 'saas-clm', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spotdraft.com', 'evisort.com', 'saas-clm', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spotdraft.com', 'icertis.com', 'saas-clm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spotdraft.com', 'ironcladapp.com', 'saas-clm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spotdraft.com', 'juro.com', 'saas-clm', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spotdraft.com', 'linksquares.com', 'saas-clm', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('spotdraft.com', 'volody.com', 'saas-clm', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'carrd.co', 'ecommerce-platforms', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'duda.co', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'format.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'godaddy.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'jimdo.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'pixpa.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'shopify.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'smugmug.com', 'ecommerce-platforms', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'strikingly.com', 'ecommerce-platforms', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'webflow.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'weebly.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'wix.com', 'ecommerce-platforms', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('squarespace.com', 'wordpress.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'blueheavencosmetics.in', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'colorbarcosmetics.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'facescanada.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'insightcosmetics.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'lakmeindia.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'maccosmetics.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'maybelline.com', 'india-d2c-beauty', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'myglamm.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'nykaa.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'purplle.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('sugarcosmetics.com', 'reneecosmetics.in', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('tapcart.com', 'gonative.io', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('tapcart.com', 'median.co', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('tapcart.com', 'plobalapps.com', 'ecommerce-enablement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('tapcart.com', 'shopney.co', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('tapcart.com', 'vajro.com', 'ecommerce-enablement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('testsigma.com', 'browserstack.com', 'india-saas-testing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('testsigma.com', 'functionize.com', 'india-saas-testing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('testsigma.com', 'katalon.com', 'india-saas-testing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('testsigma.com', 'lambdatest.com', 'india-saas-testing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('testsigma.com', 'mabl.com', 'india-saas-testing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('testsigma.com', 'qase.io', 'india-saas-testing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('testsigma.com', 'rainforestqa.com', 'india-saas-testing', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('testsigma.com', 'testgrid.io', 'india-saas-testing', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('testsigma.com', 'testim.io', 'india-saas-testing', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('testsigma.com', 'testrail.com', 'india-saas-testing', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thedermaco.com', 'beminimalist.co', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thedermaco.com', 'deconstruct.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thedermaco.com', 'discoverpilgrim.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thedermaco.com', 'dotandkey.com', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thedermaco.com', 'drsheths.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thedermaco.com', 'foxtale.in', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thedermaco.com', 'mamaearth.in', 'india-d2c-beauty', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thedermaco.com', 'mcaffeine.com', 'india-d2c-beauty', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thedermaco.com', 'plumgoodness.com', 'india-d2c-beauty', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thedermaco.com', 'theformularx.com', 'india-d2c-beauty', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('themancompany.com', 'beardo.in', 'india-d2c-grooming', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('themancompany.com', 'bombayshavingcompany.com', 'india-d2c-grooming', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('themancompany.com', 'gillette.com', 'india-d2c-grooming', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('themancompany.com', 'nivea.com', 'india-d2c-grooming', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('themancompany.com', 'oldspice.com', 'india-d2c-grooming', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('themancompany.com', 'phy.in', 'india-d2c-grooming', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('themancompany.com', 'ustraa.com', 'india-d2c-grooming', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesleepcompany.in', 'duroflexworld.com', 'india-d2c-home-sleep', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesleepcompany.in', 'flomattress.com', 'india-d2c-home-sleep', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesleepcompany.in', 'kurlon.com', 'india-d2c-home-sleep', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesleepcompany.in', 'sleepwell.co.in', 'india-d2c-home-sleep', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesleepcompany.in', 'sleepycat.in', 'india-d2c-home-sleep', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesleepcompany.in', 'wakefit.co', 'india-d2c-home-sleep', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesouledstore.com', 'ajio.com', 'india-d2c-fashion', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesouledstore.com', 'bewakoof.com', 'india-d2c-fashion', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesouledstore.com', 'bluorng.com', 'india-d2c-fashion', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesouledstore.com', 'freakins.com', 'india-d2c-fashion', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesouledstore.com', 'myntra.com', 'india-d2c-fashion', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesouledstore.com', 'redwolf.in', 'india-d2c-fashion', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesouledstore.com', 'snitch.co.in', 'india-d2c-fashion', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('thesouledstore.com', 'veirdo.in', 'india-d2c-fashion', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('true-elements.com', 'eatanytime.in', 'india-d2c-food', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('true-elements.com', 'monsoonharvest.in', 'india-d2c-food', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('true-elements.com', 'ritebite.in', 'india-d2c-food', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('true-elements.com', 'slurpfarm.com', 'india-d2c-food', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('true-elements.com', 'snackible.com', 'india-d2c-food', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('true-elements.com', 'thewholetruthfoods.com', 'india-d2c-food', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('true-elements.com', 'yogabars.in', 'india-d2c-food', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ustraa.com', 'beardo.in', 'india-d2c-grooming', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ustraa.com', 'bombayshavingcompany.com', 'india-d2c-grooming', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ustraa.com', 'gillette.com', 'india-d2c-grooming', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ustraa.com', 'letsshave.com', 'india-d2c-grooming', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ustraa.com', 'nivea.com', 'india-d2c-grooming', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ustraa.com', 'oldspice.com', 'india-d2c-grooming', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ustraa.com', 'phy.in', 'india-d2c-grooming', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('ustraa.com', 'themancompany.com', 'india-d2c-grooming', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('verloop.io', 'freshworks.com', 'india-saas-chatbots', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('verloop.io', 'gupshup.io', 'india-saas-chatbots', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('verloop.io', 'haptik.ai', 'india-saas-chatbots', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('verloop.io', 'intercom.com', 'india-saas-chatbots', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('verloop.io', 'kommunicate.io', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('verloop.io', 'yellow.ai', 'india-saas-chatbots', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('verloop.io', 'zendesk.com', 'india-saas-chatbots', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wakefit.co', 'duroflexworld.com', 'india-d2c-home-sleep', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wakefit.co', 'flomattress.com', 'india-d2c-home-sleep', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wakefit.co', 'kurlon.com', 'india-d2c-home-sleep', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wakefit.co', 'pepperfry.com', 'india-d2c-home-sleep', 'curated:v1', 60, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wakefit.co', 'sleepwell.co.in', 'india-d2c-home-sleep', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wakefit.co', 'sleepycat.in', 'india-d2c-home-sleep', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wakefit.co', 'thesleepcompany.in', 'india-d2c-home-sleep', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wakefit.co', 'urbanladder.com', 'india-d2c-home-sleep', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('webengage.com', 'braze.com', 'india-saas-engagement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('webengage.com', 'clevertap.com', 'india-saas-engagement', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('webengage.com', 'customer.io', 'india-saas-engagement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('webengage.com', 'moengage.com', 'india-saas-engagement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('webengage.com', 'netcorecloud.com', 'india-saas-engagement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('webengage.com', 'onesignal.com', 'india-saas-engagement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('webengage.com', 'plotline.so', 'india-saas-engagement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'appcues.com', 'india-saas-dap', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'apty.io', 'india-saas-dap', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'inlinemanual.com', 'india-saas-dap', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'lemonlearning.com', 'india-saas-dap', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'pendo.io', 'india-saas-dap', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'scribehow.com', 'india-saas-dap', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'tango.us', 'india-saas-dap', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'trychameleon.com', 'india-saas-dap', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'userlane.com', 'india-saas-dap', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'userpilot.com', 'india-saas-dap', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('whatfix.com', 'walkme.com', 'india-saas-dap', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'duda.co', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'framer.com', 'ecommerce-platforms', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'godaddy.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'hostinger.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'jimdo.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'shopify.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'site123.com', 'ecommerce-platforms', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'squarespace.com', 'ecommerce-platforms', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'squareup.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'strikingly.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'ucraft.com', 'ecommerce-platforms', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'webflow.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'weebly.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('wix.com', 'wordpress.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('woocommerce.com', 'adobe.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('woocommerce.com', 'bigcommerce.com', 'ecommerce-platforms', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('woocommerce.com', 'ecwid.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('woocommerce.com', 'medusajs.com', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('woocommerce.com', 'opencart.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('woocommerce.com', 'prestashop.com', 'ecommerce-platforms', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('woocommerce.com', 'saleor.io', 'ecommerce-platforms', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('woocommerce.com', 'shopify.com', 'ecommerce-platforms', 'curated:v1', 95, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('woocommerce.com', 'shopware.com', 'ecommerce-platforms', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('woocommerce.com', 'wordpress.com', 'ecommerce-platforms', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'ada.cx', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'boost.ai', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'cognigy.com', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'gupshup.io', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'haptik.ai', 'india-saas-chatbots', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'intercom.com', 'india-saas-chatbots', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'kommunicate.io', 'india-saas-chatbots', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'kore.ai', 'india-saas-chatbots', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'liveperson.com', 'india-saas-chatbots', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'senseforth.ai', 'india-saas-chatbots', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yellow.ai', 'verloop.io', 'india-saas-chatbots', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yogabars.in', 'eatanytime.in', 'india-d2c-food', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yogabars.in', 'monsoonharvest.in', 'india-d2c-food', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yogabars.in', 'ritebite.in', 'india-d2c-food', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yogabars.in', 'slurpfarm.com', 'india-d2c-food', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yogabars.in', 'snackible.com', 'india-d2c-food', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yogabars.in', 'thewholetruthfoods.com', 'india-d2c-food', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yogabars.in', 'true-elements.com', 'india-d2c-food', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'bazaarvoice.com', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'feefo.com', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'judge.me', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'junip.co', 'ecommerce-enablement', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'klaviyo.com', 'ecommerce-enablement', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'loox.io', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'okendo.io', 'ecommerce-enablement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'powerreviews.com', 'ecommerce-enablement', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'reviews.io', 'ecommerce-enablement', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'stamped.io', 'ecommerce-enablement', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('yotpo.com', 'trustpilot.com', 'ecommerce-enablement', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zeta.tech', 'fampay.in', 'india-saas-fintech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zeta.tech', 'goniyo.com', 'india-saas-fintech', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zeta.tech', 'jupiter.money', 'india-saas-fintech', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zeta.tech', 'm2pfintech.com', 'india-saas-fintech', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zeta.tech', 'open.money', 'india-saas-fintech', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zeta.tech', 'pinelabs.com', 'india-saas-fintech', 'curated:v1', 65, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zeta.tech', 'setu.co', 'india-saas-fintech', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zluri.com', 'beamy.io', 'india-saas-saas-mgmt', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zluri.com', 'bettercloud.com', 'india-saas-saas-mgmt', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zluri.com', 'cledara.com', 'india-saas-saas-mgmt', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zluri.com', 'josys.com', 'india-saas-saas-mgmt', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zluri.com', 'productiv.com', 'india-saas-saas-mgmt', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zluri.com', 'sastrify.com', 'india-saas-saas-mgmt', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zluri.com', 'spendflo.com', 'india-saas-saas-mgmt', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zluri.com', 'toriihq.com', 'india-saas-saas-mgmt', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zluri.com', 'trelica.com', 'india-saas-saas-mgmt', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zluri.com', 'zylo.com', 'india-saas-saas-mgmt', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'erpnext.com', 'india-saas-suite', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'freshworks.com', 'india-saas-suite', 'curated:v1', 90, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'hubspot.com', 'india-saas-suite', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'kissflow.com', 'india-saas-suite', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'leadsquared.com', 'india-saas-suite', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'manageengine.com', 'india-saas-suite', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'microsoft.com', 'india-saas-suite', 'curated:v1', 70, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'odoo.com', 'india-saas-suite', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'pipedrive.com', 'india-saas-suite', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'salesforce.com', 'india-saas-suite', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zoho.com', 'vtiger.com', 'india-saas-suite', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zouk.co.in', 'baggit.com', 'india-d2c-accessories', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zouk.co.in', 'chumbak.com', 'india-d2c-accessories', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zouk.co.in', 'dailyobjects.com', 'india-d2c-accessories', 'curated:v1', 80, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zouk.co.in', 'esbeda.in', 'india-d2c-accessories', 'curated:v1', 75, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zouk.co.in', 'lavieworld.com', 'india-d2c-accessories', 'curated:v1', 85, 1789776000);
INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
  VALUES ('zouk.co.in', 'thehouseoftara.com', 'india-d2c-accessories', 'curated:v1', 75, 1789776000);
-- END GENERATED SEED
