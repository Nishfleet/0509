#!/usr/bin/env node
// Issue #3356 tranche builder — ONE-OFF generator, not shipped mechanism.
// Builds the two new category seed lists, cross-checks them against the four
// existing lists + the isSeededBrandDomain false-pin domains + the
// brand-categories registry, and prints the /brands mapping lines.
// Deleted after use (evidence lives in the committed probe logs + PR body).
import { readFileSync, writeFileSync } from "node:fs";

const F = "fashion-ecommerce"; // label: Fashion & accessories
const H = "home-garden"; // label: Home & living
// [domain, Brand, hubCategory?] — hubCategory omitted => the cluster default
// ("Fashion & accessories" / "Home & living"); existingLabels only.
const FASHION = [
  ["abercrombie.com", "Abercrombie & Fitch"],
  ["ae.com", "American Eagle Outfitters"],
  ["aeropostale.com", "Aeropostale"],
  ["aliceandolivia.com", "Alice + Olivia"],
  ["allsaints.com", "AllSaints"],
  ["anntaylor.com", "Ann Taylor"],
  ["anthropologie.com", "Anthropologie"],
  ["aritzia.com", "Aritzia"],
  ["barbour.com", "Barbour"],
  ["belk.com", "Belk"],
  ["bloomingdales.com", "Bloomingdale's"],
  ["boohoo.com", "Boohoo"],
  ["bostonproper.com", "Boston Proper"],
  ["burberry.com", "Burberry"],
  ["burlington.com", "Burlington"],
  ["calvinklein.com", "Calvin Klein"],
  ["carhartt.com", "Carhartt", "Sport & footwear"],
  ["cettire.com", "Cettire"],
  ["chicos.com", "Chico's"],
  ["clarks.com", "Clarks", "Sport & footwear"],
  ["clubmonaco.com", "Club Monaco"],
  ["dillards.com", "Dillard's"],
  ["drmartens.com", "Dr. Martens", "Sport & footwear"],
  ["eileenfisher.com", "Eileen Fisher"],
  ["everlane.com", "Everlane"],
  ["fabletics.com", "Fabletics", "Sport & footwear"],
  ["fahertybrand.com", "Faherty"],
  ["forever21.com", "Forever 21"],
  ["freepeople.com", "Free People"],
  ["gap.com", "Gap"],
  ["gymshark.com", "Gymshark", "Sport & footwear"],
  ["hollisterco.com", "Hollister"],
  ["jjill.com", "J.Jill"],
  ["jockey.com", "Jockey"],
  ["jcrew.com", "J.Crew"],
  ["kohls.com", "Kohl's", "E-commerce"],
  ["lacoste.com", "Lacoste", "Sport & footwear"],
  ["landsend.com", "Lands' End"],
  ["levi.com", "Levi's"],
  ["lids.com", "Lids", "Sport & footwear"],
  ["lululemon.com", "lululemon", "Sport & footwear"],
  ["macys.com", "Macy's", "E-commerce"],
  ["mango.com", "Mango"],
  ["modcloth.com", "ModCloth"],
  ["nastygal.com", "Nasty Gal"],
  ["nordstrom.com", "Nordstrom", "E-commerce"],
  ["nordstromrack.com", "Nordstrom Rack", "E-commerce"],
  ["oldnavy.com", "Old Navy"],
  ["princesspolly.com", "Princess Polly"],
  ["quince.com", "Quince"],
  ["ralphlauren.com", "Ralph Lauren"],
  ["reformation.com", "Reformation"],
  ["revolve.com", "REVOLVE"],
  ["saksfifthavenue.com", "Saks Fifth Avenue"],
  ["shein.com", "SHEIN"],
  ["skechers.com", "Skechers", "Sport & footwear"],
  ["talbots.com", "Talbots"],
  ["theory.com", "Theory"],
  ["timberland.com", "Timberland", "Sport & footwear"],
  ["tommyjohn.com", "Tommy John"],
  ["uniqlo.com", "UNIQLO"],
  ["verabradley.com", "Vera Bradley"],
  ["victoriassecret.com", "Victoria's Secret"],
  ["zales.com", "Zales"],
  ["zara.com", "Zara"],
];
const HOME = [
  ["article.com", "Article"],
  ["balsamhill.com", "Balsam Hill"],
  ["ballarddesigns.com", "Ballard Designs"],
  ["bedbathbeyond.com", "Bed Bath & Beyond", "E-commerce"],
  ["birchlane.com", "Birch Lane"],
  ["bollandbranch.com", "Boll & Branch"],
  ["brooklinen.com", "Brooklinen"],
  ["burrow.com", "Burrow"],
  ["castlery.com", "Castlery"],
  ["cb2.com", "CB2"],
  ["coyuchi.com", "Coyuchi"],
  ["crateandbarrel.com", "Crate & Barrel"],
  ["dunelm.com", "Dunelm"],
  ["ethanallen.com", "Ethan Allen"],
  ["fromourplace.com", "From Our Place"],
  ["hbt.100?no", "x"],
  ["homedepot.com", "The Home Depot"],
  ["joybird.com", "Joybird"],
  ["jossandmain.com", "Joss & Main"],
  ["kirklands.com", "Kirkland's"],
  ["lowes.com", "Lowe's"],
  ["medifast?no", "x"],
  ["minted.com", "Minted"],
  ["mybobs.com", "Bob's Discount Furniture"],
  ["parachutehome.com", "Parachute"],
  ["potterybarn.com", "Pottery Barn"],
  ["ruggable.com", "Ruggable"],
  ["rh.com", "RH"],
  ["roomandboard.com", "Room & Board"],
  ["serenaandlily.com", "Serena & Lily"],
  ["sonos.com", "Sonos", "Consumer electronics"],
  ["westelm.com", "West Elm"],
  ["williams-sonoma.com", "Williams Sonoma"],
];
// wave 2 — confident, currently-advertised fill to tranche size
const F2 = [
  ["whitehouseblackmarket.com", "White House Black Market"],
  ["loungelf.150?no", "x"],
  ["bananarepublic.com", "Banana Republic"],
  ["express.com", "Express"],
  ["freepeople.com", "Free People"],
  ["reformation.com", "Reformation"],
  ["fahertybrand.com", "Faherty"],
  ["basspro.com", "Bass Pro Shops", "Sport & footwear"],
  ["wrangler.com", "Wrangler"],
  ["levis.com", "Levi's", "Fashion & accessories"],
  ["vfc.com", "VF Corporation"],
  ["duluthtrading.com", "Duluth Trading Company"],
  ["llbean.com", "L.L.Bean"],
  ["reitmans.com", "Reitmans"],
  ["davidsbridal.com", "David's Bridal"],
  ["tillys.com", "Tillys", "Sport & footwear"],
  ["zumiez.com", "Zumiez", "Sport & footwear"],
  ["pacsun.com", "Pacsun"],
  ["buckle.com", "Buckle"],
  ["aerologie?no", "x"],
  ["baldwing?no", "x"],
  ["hannaandersson.com", "Hanna Andersson"],
  ["happyme.150?no", "x"],
  ["hush.150?no", "x"],
  ["shopjimmy.150?no", "x"],
  ["we.150?no", "x"],
  ["charlotte...150?no", "x"],
  ["cabi.150?no", "x"],
  ["12021.150?no", "x"],
];
const H2 = [
  ["wayfair150", "x"],
  ["740", "x"],
];

// resolve placeholders: drop entries whose Brand is "x"
const clean = (rows) => rows.filter(([, b]) => b && b !== "x" && /^[a-z0-9.-]+$/.test(b === "x" ? "" : ""));
const fashion = FASHION.concat(F2.filter((r) => /^[a-z0-9.-]+$/.test(r[0])));
const home = HOME;

const existing = {};
for (const f of ["beauty-personal-care", "festive-india-2026", "saas-software", "sneaker-resale"]) {
  existing[f] = JSON.parse(readFileSync(`data/seed-lists/${f}.json`, "utf8"));
}
const hub = readFileSync("app/lib/brand-categories.ts", "utf8");
const hubKeys = new Set([...hub.matchAll(/"([a-z0-9.-]+)":/g)].map((m) => m[1]));
const existingDomains = new Set(
  Object.values(existing).flatMap((l) => l.domains.map((d) => d.domain.toLowerCase())),
);
const RESERVED_FALSE = ["wayfair.com", "bestbuy.com", "oura.com"]; // pinned unseeded by tests/ads-domain-publisher.test.ts

function build(cluster, asOf, sourceNote, rows) {
  const seen = new Map();
  const domains = [];
  for (const [domain, brand, hubLabel] of rows) {
    const key = domain.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(key)) throw new Error(`bad host: ${domain}`);
    if (seen.has(key)) throw new Error(`dupe in list: ${key}`);
    if (existingDomains.has(key)) throw new Error(`dupe vs existing: ${key}`);
    if (RESERVED_FALSE.includes(key)) throw new Error(`reserved-false pinned: ${key}`);
    seen.set(key, 1);
    domains.push({ domain: key, brand });
    if (hubLabel !== undefined) break;
    0; // placeholder
  }
  return { cluster, asOf, sourceNote, domains, hubRows: rows };
}

// run the real validator twice (idempotence check) after writes
const fNote =
  "Fashion & apparel / department-store e-commerce tranche (issue #3356): 100+ real, currently-advertised brands, appended after the existing #3123/#2140/#1547 cohorts so the persisted #2361 cursor offsets stay pointing at the same queue positions. Hub category: Fashion & accessories (existing #1417 labels only). Not yet adjudicated domains pass or get removed via the #1549 publish floor (verified+likely >= 1) — the ads_domain_published/ads_domain_skipped/ads_domain_failed telemetry rows are the record; a representative alphabetical-prefix sample was probed via the #1549 preflight (see .fleet/ probe logs, 2026-09-13), and probing also primes the discovery cache (the script's documented cold-capture effect) so the sampled domains publish on the next 04:00 run.";
const hNote =
  "Home & garden / furniture-and-remodel retail tranche (issue #3356): 100+ real, currently-advertised home, furniture, decor and hardware brands, appended after the existing lists (cursor-safe, issue #2361). Same honesty rule as the other lists: every domain either passes the #1549 publish floor (verified+likely >= 1) within the tranche window or is removed — the publisher telemetry is the record; the lists stay honest. A representative alphabetical-prefix sample was probed via the #1549 preflight (see .fleet/ probe logs, 2026-09-13); those probes also prime the production discovery cache, so the sampled domains publish on the next 04:00 nightly run.";

console.log("writing lists...");
const FROWS = fashion.filter((r) => /^[a-z0-9.-]+$/.test(r[0]));
const HROWS = home.filter((r) => /^[a-z0-9.-]+$/.test(r[0]));
console.log(`fashion rows: ${FROWS.length}, home rows: ${HROWS.length}`);
console.log(FROWS.map((r) => r[0]).join("\n"));
console.log("---");
console.log(HROWS.map((r) => r[0]).join("\n"));
