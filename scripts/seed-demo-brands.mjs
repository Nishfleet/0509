#!/usr/bin/env node
/**
 * Issue #2344 — demo-brand + sitemap-brand offer-timeline seed runbook.
 *
 * Migrations 0079 (`demo_brand_backfill`) and 0081 (`sitemap_brand_backfill`)
 * used to bake demo rows into the schema chain, so every fresh D1 — including
 * every integration-test database built by `tests/integration/apply-migrations.ts`
 * — inherited demo seed rows. Those migrations stay in the chain byte-for-byte
 * for production (the prod D1 ledger already applied them). This runbook is the
 * only place a schema-ONLY database gets those rows: apply the migrations, then
 * run this script against that database when demo data is wanted.
 *
 * The seed data is exported both as a reusable SQL string and as a runnable CLI
 * so the `workers` integration project can exec the exact statements onto the
 * local test D1 and assert the honest-evidence contract from the migrations:
 *   * No screenshots are fabricated — `artifact_key` stays NULL and
 *     `metadata_json` marks `backfill: true` with the original source.
 *   * `capture_method` is `demo_backfill` (0079) / `sitemap_brand_seed` (0081),
 *     values the live monitoring write path never produces, so a future audit
 *     can tell seeded rows from real captures.
 *   * Every statement is additive and idempotent (`INSERT OR IGNORE` with
 *     deterministic ids), so a re-run is a no-op and rollback is simply
 *     `DELETE WHERE capture_method IN ('demo_backfill','sitemap_brand_seed')`.
 *
 * Usage:
 *   # See the command surface.
 *   node scripts/seed-demo-brands.mjs --help
 *
 *   # Seed the local dev D1 (default; no network).
 *   node scripts/seed-demo-brands.mjs
 *
 *   # Seed the remote production D1 (operator-only, mirrors migration 0079/0081).
 *   node scripts/seed-demo-brands.mjs --remote [--database 0509]
 *
 *   # Dry-run: write the generated `.sql` to a file instead of executing it.
 *   node scripts/seed-demo-brands.mjs --out-file /tmp/seed-demo-brands.sql
 *
 * The module body is intentionally free of top-level Node imports so the pure
 * seed data / SQL exports stay importable inside the workerd-backing `workers`
 * vitest project (integration tests exec these exact statements onto local D1).
 * CLI-only Node builtins are pulled in lazily only when run as a script.
 */

/** @type {Array<{ id: string; domain: string; rawHeadline: string; normalizedHeadline: string }>} */
const DEMO_BRANDS = [
  {
    id: "backfill-nike-20260825",
    domain: "https://www.nike.com/",
    rawHeadline: "Nike. Just Do It.",
    normalizedHeadline: "nike. just do it.",
  },
  {
    id: "backfill-nykaa-20260825",
    domain: "https://www.nykaa.com/",
    rawHeadline: "Nykaa. Beauty and wellness.",
    normalizedHeadline: "nykaa. beauty and wellness.",
  },
  {
    id: "backfill-allbirds-20260825",
    domain: "https://www.allbirds.com/",
    rawHeadline: "Allbirds. Comfortable, sustainable shoes.",
    normalizedHeadline: "allbirds. comfortable, sustainable shoes.",
  },
  {
    id: "backfill-lenskart-20260825",
    domain: "https://www.lenskart.com/",
    rawHeadline: "Lenskart. Eyewear for everyone.",
    normalizedHeadline: "lenskart. eyewear for everyone.",
  },
  {
    id: "backfill-mamaearth-20260825",
    domain: "https://www.mamaearth.com/",
    rawHeadline: "Mamaearth. Toxin-free care.",
    normalizedHeadline: "mamaearth. toxin-free care.",
  },
];

/** @type {Array<{ id: string; domain: string; rawHeadline: string; normalizedHeadline: string }>} */
const SITEMAP_BRANDS = [
  {
    id: "backfill-adidas-20260825",
    domain: "https://www.adidas.com/",
    rawHeadline: "adidas. Athletic footwear and apparel.",
    normalizedHeadline: "adidas. athletic footwear and apparel.",
  },
  {
    id: "backfill-adobe-20260825",
    domain: "https://www.adobe.com/",
    rawHeadline: "Adobe. Creative and document software.",
    normalizedHeadline: "adobe. creative and document software.",
  },
  {
    id: "backfill-amazon-20260825",
    domain: "https://www.amazon.com/",
    rawHeadline: "Amazon. Online marketplace and store.",
    normalizedHeadline: "amazon. online marketplace and store.",
  },
  {
    id: "backfill-asos-20260825",
    domain: "https://www.asos.com/",
    rawHeadline: "ASOS. Online fashion and clothing.",
    normalizedHeadline: "asos. online fashion and clothing.",
  },
  {
    id: "backfill-atlassian-20260825",
    domain: "https://www.atlassian.com/",
    rawHeadline: "Atlassian. Team collaboration and project tools.",
    normalizedHeadline: "atlassian. team collaboration and project tools.",
  },
  {
    id: "backfill-bombas-20260825",
    domain: "https://www.bombas.com/",
    rawHeadline: "Bombas. Comfortable socks and apparel.",
    normalizedHeadline: "bombas. comfortable socks and apparel.",
  },
  {
    id: "backfill-bombayshavingcompany-20260825",
    domain: "https://www.bombayshavingcompany.com/",
    rawHeadline: "Bombay Shaving Company. Men's grooming and shaving.",
    normalizedHeadline: "bombay shaving company. men's grooming and shaving.",
  },
  {
    id: "backfill-canva-20260825",
    domain: "https://www.canva.com/",
    rawHeadline: "Canva. Online design and creation tools.",
    normalizedHeadline: "canva. online design and creation tools.",
  },
  {
    id: "backfill-celonis-20260825",
    domain: "https://www.celonis.com/",
    rawHeadline: "Celonis. Process mining and execution management.",
    normalizedHeadline: "celonis. process mining and execution management.",
  },
  {
    id: "backfill-decathlon-20260825",
    domain: "https://www.decathlon.com/",
    rawHeadline: "Decathlon. Sporting goods and equipment.",
    normalizedHeadline: "decathlon. sporting goods and equipment.",
  },
  {
    id: "backfill-figma-20260825",
    domain: "https://www.figma.com/",
    rawHeadline: "Figma. Collaborative interface design.",
    normalizedHeadline: "figma. collaborative interface design.",
  },
  {
    id: "backfill-gymshark-20260825",
    domain: "https://www.gymshark.com/",
    rawHeadline: "Gymshark. Fitness apparel and accessories.",
    normalizedHeadline: "gymshark. fitness apparel and accessories.",
  },
  {
    id: "backfill-hm-20260825",
    domain: "https://www.hm.com/",
    rawHeadline: "H&M. Fashion and clothing.",
    normalizedHeadline: "h&m. fashion and clothing.",
  },
  {
    id: "backfill-hubspot-20260825",
    domain: "https://www.hubspot.com/",
    rawHeadline: "HubSpot. CRM and marketing software.",
    normalizedHeadline: "hubspot. crm and marketing software.",
  },
  {
    id: "backfill-mcaffeine-20260825",
    domain: "https://www.mcaffeine.com/",
    rawHeadline: "mCaffeine. Caffeine-infused personal care.",
    normalizedHeadline: "mcaffeine. caffeine-infused personal care.",
  },
  {
    id: "backfill-ouraring-20260825",
    domain: "https://www.ouraring.com/",
    rawHeadline: "Oura. Smart ring health tracking.",
    normalizedHeadline: "oura. smart ring health tracking.",
  },
  {
    id: "backfill-personio-20260825",
    domain: "https://www.personio.com/",
    rawHeadline: "Personio. HR software and management.",
    normalizedHeadline: "personio. hr software and management.",
  },
  {
    id: "backfill-ridge-20260825",
    domain: "https://www.ridge.com/",
    rawHeadline: "Ridge. Minimalist wallets and everyday carry.",
    normalizedHeadline: "ridge. minimalist wallets and everyday carry.",
  },
  {
    id: "backfill-ridgewallet-20260825",
    domain: "https://www.ridgewallet.com/",
    rawHeadline: "Ridge Wallet. Minimalist RFID-blocking wallets.",
    normalizedHeadline: "ridge wallet. minimalist rfid-blocking wallets.",
  },
  {
    id: "backfill-sephora-20260825",
    domain: "https://www.sephora.com/",
    rawHeadline: "Sephora. Beauty products and cosmetics.",
    normalizedHeadline: "sephora. beauty products and cosmetics.",
  },
  {
    id: "backfill-shopify-20260825",
    domain: "https://www.shopify.com/",
    rawHeadline: "Shopify. E-commerce platform for online stores.",
    normalizedHeadline: "shopify. e-commerce platform for online stores.",
  },
  {
    id: "backfill-sugarcosmetics-20260825",
    domain: "https://www.sugarcosmetics.com/",
    rawHeadline: "Sugar Cosmetics. Makeup and beauty products.",
    normalizedHeadline: "sugar cosmetics. makeup and beauty products.",
  },
  {
    id: "backfill-ulta-20260825",
    domain: "https://www.ulta.com/",
    rawHeadline: "Ulta Beauty. Beauty products and salon services.",
    normalizedHeadline: "ulta beauty. beauty products and salon services.",
  },
  {
    id: "backfill-walmart-20260825",
    domain: "https://www.walmart.com/",
    rawHeadline: "Walmart. Retail and online shopping.",
    normalizedHeadline: "walmart. retail and online shopping.",
  },
  {
    id: "backfill-zoho-20260825",
    domain: "https://www.zoho.com/",
    rawHeadline: "Zoho. Business software and productivity tools.",
    normalizedHeadline: "zoho. business software and productivity tools.",
  },
];

const LANDING_COLUMNS = [
  "id",
  "raw_url",
  "canonical_url",
  "raw_headline",
  "normalized_headline",
  "normalized_headline_hash",
  "capture_method",
  "artifact_key",
  "metadata_json",
  "cta_text",
  "price_text",
  "form_present",
  "ocr_text",
  "translated_text",
  "captured_at",
  "created_at",
];

/** Wrap a value as a single-quoted SQL string literal (doubling embedded quotes). */
function sqlStr(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Build the `INSERT OR IGNORE` statement for one quoted-row set. Quoting is
 * defensive (matches the migration files' literal single quotes); ids are
 * deterministic so a re-run is a no-op.
 *
 * @param {{ id: string; domain: string; rawHeadline: string; normalizedHeadline: string }[]} brands
 * @param {"demo_backfill" | "sitemap_brand_seed"} captureMethod
 * @param {string} metadataSource
 * @param {string} createdAt
 */
function buildInsert(brands, captureMethod, metadataSource, createdAt) {
  const values = brands
    .map((b) => {
      const domain = b.domain.replace(/\/$/, "");
      const capturedAt = "2026-08-25T00:00:00.000Z";
      const fields = [
        sqlStr(b.id),
        sqlStr(`${domain}/`),
        sqlStr(`${domain}/`),
        sqlStr(b.rawHeadline),
        sqlStr(b.normalizedHeadline),
        sqlStr(b.id),
        sqlStr(captureMethod),
        "NULL",
        sqlStr(`{"backfill":true,"source":"${metadataSource}"}`),
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        sqlStr(capturedAt),
        sqlStr(createdAt),
      ];
      return `  (${fields.join(", ")})`;
    })
    .join(",\n");
  return [
    `INSERT OR IGNORE INTO landing_page_snapshot (`,
    `  ${LANDING_COLUMNS.join(", ")}`,
    `)`,
    `VALUES`,
    values,
    `;`,
  ].join("\n");
}

/** The 5 demo-brand seed statement formerly split out of migration 0079. */
export const DEMO_BRAND_SEED_SQL = buildInsert(
  DEMO_BRANDS,
  "demo_backfill",
  "demo_brand_seed",
  "2026-08-27T00:00:00.000Z",
);

/** The 25 sitemap-brand seed statement formerly split out of migration 0081. */
export const SITEMAP_BRAND_SEED_SQL = buildInsert(
  SITEMAP_BRANDS,
  "sitemap_brand_seed",
  "sitemap_brand_seed",
  "2026-08-28T00:00:00.000Z",
);

/** The migration file names whose seed data moved into this runbook. */
export const SEED_MIGRATIONS = [
  "0079_backfill_demo_brand_offer_timelines.sql",
  "0081_backfill_sitemap_brand_offer_timelines.sql",
];

/**
 * The full runbook SQL: both seed statements in dependency order (demo first,
 * matching migration order), separated by a blank line.
 */
export function demoBrandSeedSql() {
  return `${DEMO_BRAND_SEED_SQL}\n\n${SITEMAP_BRAND_SEED_SQL}`;
}

function printHelp() {
  console.log(`Usage: node scripts/seed-demo-brands.mjs [options]

Apply the issue #2344 demo/sitemap brand seed rows to a D1 database. The rows
used to arrive via migrations 0079/0081; this runbook is how a schema-only D1
(no demo seed rows) gets them.

Options:
  --remote         Target the remote D1 database instead of the local dev one.
  --database NAME  Database name to execute against (default: 0509).
  --out-file PATH  Write the generated .sql to PATH instead of executing it.
  --all            Emit both demo and sitemap statements (this is the default).
  --demo-only      Emit only the 5 demo-brand statement (0079).
  --sitemap-only   Emit only the 25 sitemap-brand statement (0081).
  -h, --help       Show this help.`);
}

function valueAfter(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const outFile = valueAfter(argv, "--out-file");
  const database = valueAfter(argv, "--database") ?? "0509";
  const remote = argv.includes("--remote");
  const demoOnly = argv.includes("--demo-only");
  const sitemapOnly = argv.includes("--sitemap-only");

  let sql;
  if (demoOnly) sql = DEMO_BRAND_SEED_SQL;
  else if (sitemapOnly) sql = SITEMAP_BRAND_SEED_SQL;
  else sql = demoBrandSeedSql();

  if (outFile) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outFile, `${sql}\n`, "utf8");
    console.log(`Wrote seed SQL to ${outFile}`);
    return;
  }

  // Lazily load Node-only machinery only on the CLI path so the module stays
  // importable inside the workerd-backed `workers` vitest project.
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      database,
      remote ? "--remote" : "--local",
      "--command",
      sql,
    ],
    { encoding: "utf8", env: process.env, maxBuffer: 1024 * 1024 * 10 },
  );
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `wrangler d1 execute failed${message ? `: ${message}` : ""}`,
    );
  }
  const summary = (result.stdout || "").trim();
  const scope = demoOnly
    ? "demo brands (0079)"
    : sitemapOnly
      ? "sitemap brands (0081)"
      : "demo + sitemap brands (0079+0081)";
  console.log(
    `Seeded ${scope} into ${database} (${remote ? "remote" : "local"}).\n${summary}`,
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err?.message ?? String(err));
    process.exitCode = 1;
  });
}
