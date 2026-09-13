#!/usr/bin/env node
// Issue #3356 tranche builder — ONE-OFF generator, not shipped mechanism.
// Writes the two new category seed lists (fashion-ecommerce, home-garden),
// validating each row against the four existing lists, the test-pinned
// unseeded domains, and the host/duplicate/brand honesty rules. Printed
// evidence goes to the committed probe logs + PR body; the file is deleted
// after use so the shipped mechanism stays data + registry only.
import { readFileSync, writeFileSync } from "node:fs";

// [domain, brand] — the prior run's Fashion cohort (alphabetical, #3356 wave 1)
// then its wave-2 fill, then the confident completion. Existing 121 domains,
// the test-pinned unseeded domains (tests/ads-domain-publisher.test.ts) and
// intra-list duplicates are all guarded below.
const FASHION_A = [
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
  ["carhartt.com", "Carhartt"],
  ["cettire.com", "Cettire"],
  ["chicos.com", "Chico's"],
  ["clarks.com", "Clarks"],
  ["clubmonaco.com", "Club Monaco"],
  ["dillards.com", "Dillard's"],
  ["drmartens.com", "Dr. Martens"],
  ["eileenfisher.com", "Eileen Fisher"],
  ["everlane.com", "Everlane"],
  ["fabletics.com", "Fabletics"],
  ["fahertybrand.com", "Faherty"],
  ["forever21.com", "Forever 21"],
  ["freepeople.com", "Free People"],
  ["gap.com", "Gap"],
  ["gymshark.com", "Gymshark"],
  ["hollisterco.com", "Hollister"],
  ["jjill.com", "J.Jill"],
  ["jockey.com", "Jockey"],
  ["jcrew.com", "J.Crew"],
  ["kohls.com", "Kohl's"],
  ["lacoste.com", "Lacoste"],
  ["landsend.com", "Lands' End"],
  ["levi.com", "Levi's"],
  ["lids.com", "Lids"],
  ["lululemon.com", "lululemon"],
  ["macys.com", "Macy's"],
  ["mango.com", "Mango"],
  ["modcloth.com", "ModCloth"],
  ["nastygal.com", "Nasty Gal"],
  ["nordstrom.com", "Nordstrom"],
  ["nordstromrack.com", "Nordstrom Rack"],
  ["oldnavy.com", "Old Navy"],
  ["princesspolly.com", "Princess Polly"],
  ["quince.com", "Quince"],
  ["ralphlauren.com", "Ralph Lauren"],
  ["reformation.com", "Reformation"],
  ["revolve.com", "REVOLVE"],
  ["saksfifthavenue.com", "Saks Fifth Avenue"],
  ["shein.com", "SHEIN"],
  ["skechers.com", "Skechers"],
  ["talbots.com", "Talbots"],
  ["theory.com", "Theory"],
  ["timberland.com", "Timberland"],
  ["tommyjohn.com", "Tommy John"],
  ["uniqlo.com", "UNIQLO"],
  ["verabradley.com", "Vera Bradley"],
  ["victoriassecret.com", "Victoria's Secret"],
  ["zales.com", "Zales"],
  ["zara.com", "Zara"],
];
// wave 2 — the prior run's F2 fill, deduped against wave 1 (freepeople,
// reformation, fahertybrand) with levi.com (already listed) and the
// corporate-holding/weak rows (vfc.com) dropped.
const FASHION_B = [
  ["whitehouseblackmarket.com", "White House Black Market"],
  ["bananarepublic.com", "Banana Republic"],
  ["express.com", "Express"],
  ["basspro.com", "Bass Pro Shops"],
  ["wrangler.com", "Wrangler"],
  ["duluthtrading.com", "Duluth Trading"],
  ["llbean.com", "L.L.Bean"],
  ["reitmans.com", "Reitmans"],
  ["davidsbridal.com", "David's Bridal"],
  ["charlotterusse.com", "Charlotte Russe"],
  ["tillys.com", "Tilly's"],
  ["zumiez.com", "Zumiez"],
  ["pacsun.com", "Pacsun"],
  ["buckle.com", "Buckle"],
  ["hannaandersson.com", "Hanna Andersson"],
];
// wave 3 — confident, currently-advertised fashion additions.
const FASHION_C = [
  ["coach.com", "Coach"],
  ["michaelkors.com", "Michael Kors"],
  ["katespade.com", "Kate Spade"],
  ["toryburch.com", "Tory Burch"],
  ["gucci.com", "Gucci"],
  ["louisvuitton.com", "Louis Vuitton"],
  ["prada.com", "Prada"],
  ["gstar.com", "G-Star RAW"],
  ["hottopic.com", "Hot Topic"],
  ["torrid.com", "Torrid"],
  ["lanebryant.com", "Lane Bryant"],
  ["ssense.com", "SSENSE"],
  ["farfetch.com", "FARFETCH"],
  ["bonobos.com", "Bonobos"],
  ["untuckit.com", "UNTUCKit"],
  ["luckybrand.com", "Lucky Brand"],
  ["madewell.com", "Madewell"],
  ["mytheresa.com", "MYTHERESA"],
  ["net-a-porter.com", "NET-A-PORTER"],
  ["cos.com", "COS"],
];

// wave 4 — confident, currently-advertised fashion additions (issue #3356 wave 4).
const FASHION_D = [
  ["allbirds.com", "Allbirds"],
  ["arcteryx.com", "Arc'teryx"],
  ["armani.com", "Giorgio Armani"],
  ["brooksrunning.com", "Brooks Running"],
  ["columbia.com", "Columbia"],
  ["diesel.com", "Diesel"],
  ["dolcegabbana.com", "Dolce & Gabbana"],
  ["endclothing.com", "END. Clothing"],
  ["fjallraven.com", "Fjallraven"],
  ["filson.com", "Filson"],
  ["huckberry.com", "Huckberry"],
  ["marinelayer.com", "Marine Layer"],
  ["merrell.com", "Merrell"],
  ["mizzenandmain.com", "Mizzen+Main"],
  ["mrporter.com", "MR PORTER"],
  ["patagonia.com", "Patagonia"],
  ["prettylittlething.com", "PrettyLittleThing"],
  ["salomon.com", "Salomon"],
  ["stoneisland.com", "Stone Island"],
  ["taylorstitch.com", "Taylor Stitch"],
  ["thenorthface.com", "The North Face"],
  ["toddsnyder.com", "Todd Snyder"],
  ["versace.com", "Versace"],
  ["vuoriclothing.com", "Vuori"],
  ["woolrich.com", "Woolrich"],
];

const HOME_A = [
  ["article.com", "Article"],
  ["balsamhill.com", "Balsam Hill"],
  ["ballarddesigns.com", "Ballard Designs"],
  ["bedbathbeyond.com", "Bed Bath & Beyond"],
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
  ["homedepot.com", "The Home Depot"],
  ["joybird.com", "Joybird"],
  ["jossandmain.com", "Joss & Main"],
  ["kirklands.com", "Kirkland's"],
  ["lowes.com", "Lowe's"],
  ["minted.com", "Minted"],
  ["mybobs.com", "Bob's Discount Furniture"],
  ["parachutehome.com", "Parachute"],
  ["potterybarn.com", "Pottery Barn"],
  ["ruggable.com", "Ruggable"],
  ["rh.com", "RH"],
  ["roomandboard.com", "Room & Board"],
  ["serenaandlily.com", "Serena & Lily"],
  ["sonos.com", "Sonos"],
  ["westelm.com", "West Elm"],
  ["williams-sonoma.com", "Williams Sonoma"],
];
// wave 2 — big-box, home-furniture and mattress/garden fill (issue #3356).
const HOME_B = [
  ["1stdibs.com", "1stDibs"],
  ["arhaus.com", "Arhaus"],
  ["athome.com", "At Home"],
  ["biglots.com", "Big Lots"],
  ["burpee.com", "Burpee"],
  ["casper.com", "Casper"],
  ["costco.com", "Costco"],
  ["flooranddecor.com", "Floor & Decor"],
  ["gardeners.com", "Gardener's Supply"],
  ["harborfreight.com", "Harbor Freight Tools"],
  ["ikea.com", "IKEA"],
  ["lovesac.com", "Lovesac"],
  ["menards.com", "Menards"],
  ["purple.com", "Purple"],
  ["saatva.com", "Saatva"],
  ["sleepnumber.com", "Sleep Number"],
  ["target.com", "Target"],
  ["tractorsupply.com", "Tractor Supply Co."],
  ["walmart.com", "Walmart"],
  ["worldmarket.com", "World Market"],
];

// wave 3 — big-box, home-furniture and mattress/garden fill (issue #3356).
const HOME_C = [
  ["acehardware.com", "Ace Hardware"],
  ["allmodern.com", "AllModern"],
  ["apt2b.com", "Apt2B"],
  ["ashleyfurniture.com", "Ashley"],
  ["avocadogreenmattress.com", "Avocado Green Mattress"],
  ["bearmattress.com", "Bear Mattress"],
  ["blueland.com", "Blueland"],
  ["companystore.com", "The Company Store"],
  ["dreamcloudsleep.com", "DreamCloud"],
  ["dyson.com", "Dyson"],
  ["ferguson.com", "Ferguson"],
  ["garnethill.com", "Garnet Hill"],
  ["generac.com", "Generac"],
  ["grandinroad.com", "Grandin Road"],
  ["grove.co", "Grove"],
  ["havertys.com", "Havertys"],
  ["helixsleep.com", "Helix Sleep"],
  ["husqvarna.com", "Husqvarna"],
  ["jcpenney.com", "JCPenney"],
  ["la-z-boy.com", "La-Z-Boy"],
  ["leesa.com", "Leesa"],
  ["miraclegro.com", "Miracle-Gro"],
  ["nectarsleep.com", "Nectar"],
  ["northerntool.com", "Northern Tool"],
  ["overstock.com", "Overstock"],
  ["perigold.com", "Perigold"],
  ["rejuvenation.com", "Rejuvenation"],
  ["roborock.com", "Roborock"],
  ["roomstogo.com", "Rooms To Go"],
  ["scotts.com", "Scotts"],
  ["sherwin-williams.com", "Sherwin-Williams"],
  ["sharkninja.com", "SharkNinja"],
  ["thuma.co", "Thuma"],
  ["tileshop.com", "Tile Shop"],
  ["toro.com", "Toro"],
  ["traeger.com", "Traeger"],
  ["tuftandneedle.com", "Tuft & Needle"],
  ["weber.com", "Weber"],
  ["whiteflowerfarm.com", "White Flower Farm"],
];

const EXISTING = [
  "beauty-personal-care",
  "festive-india-2026",
  "saas-software",
  "sneaker-resale",
];

const fNote =
  "Fashion and apparel / department-store tranche (issue #3356): 125 real, currently-advertised fashion, apparel, footwear, jewelry and department-store brands, appended after the existing #3123/#2140/#1547 cohorts so the persisted #2361 cursor offsets keep pointing at the same queue positions. Same honesty rule as the other lists: every domain either passes the #1549 publish floor (verified+likely >= 1) within the tranche window or is removed, with the ads_domain_published/ads_domain_skipped/ads_domain_failed telemetry rows as the record — the #1549 nightly's own floor telemetry is the evidence, and non-passing domains come off the list in the tranche-window prune.";
const hNote =
  "Home and garden / furniture-and-remodel retail tranche (issue #3356): 90 real, currently-advertised home, furniture, decor, bedding, mattress, garden and home-improvement brands, appended after the existing lists (cursor-safe, issue #2361). Same honesty rule as the other lists: every domain either passes the #1549 publish floor (verified+likely >= 1) within the tranche window or is removed, with the ads_domain_published/ads_domain_skipped/ads_domain_failed telemetry rows as the record — the #1549 nightly's own floor telemetry is the evidence, and non-passing domains come off the list in the tranche-window prune.";

const existingDomains = new Set(
  EXISTING.flatMap((f) =>
    JSON.parse(readFileSync(`data/seed-lists/${f}.json`, "utf8")).domains.map((d) =>
      d.domain.toLowerCase(),
    ),
  ),
);
// domains pinned UNSEEDED by tests/ads-domain-publisher.test.ts it.each([...], false)
const RESERVED_UNSEEDED = ["wayfair.com", "bestbuy.com", "oura.com", "example.com"];

function build(cluster, rows) {
  const seen = new Set();
  const domains = [];
  for (const [domain, brand] of rows) {
    const key = String(domain).toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(key)) throw new Error(`bad host: ${domain}`);
    if (seen.has(key)) throw new Error(`dupe in list: ${key}`);
    if (existingDomains.has(key)) throw new Error(`dupe vs existing lists: ${key}`);
    if (RESERVED_UNSEEDED.includes(key)) throw new Error(`reserved-unseeded pin: ${key}`);
    if (!brand?.trim() || brand.trim().toLowerCase() === "placeholder") {
      throw new Error(`honesty rule (brand display name): ${key}`);
    }
    if (!/^[\x20-\x7e]*$/.test(brand)) throw new Error(`non-ascii brand: ${key}`);
    seen.add(key);
    domains.push({ domain: key, brand: brand.trim() });
  }
  if (domains.length > 200) throw new Error(`${cluster} exceeds the 200-entry ceiling`);
  return { cluster, asOf: "2026-09-13", sourceNote: "", domains };
}

const fashion = build("fashion-ecommerce", [...FASHION_A, ...FASHION_B, ...FASHION_C, ...FASHION_D]);
const home = build("home-garden", [...HOME_A, ...HOME_B, ...HOME_C]);
fashion.sourceNote = fNote;
home.sourceNote = hNote;

console.log(`fashion-ecommerce: ${fashion.domains.length} domains`);
console.log(`home-garden: ${home.domains.length} domains`);
console.log(`tranche total added: ${fashion.domains.length + home.domains.length}`);
// informational: how many of the new domains already have a curated /brands
// hub category (the honest BRAND_CATEGORY_OTHER fallback covers the rest).
const hub = readFileSync("app/lib/brand-categories.ts", "utf8");
const mapped = [...fashion.domains, ...home.domains].filter((d) =>
  hub.includes(`"${d.domain}":`),
);
console.log(`already in the #1417 hub registry: ${mapped.length} (${mapped.map((d) => d.domain).join(", ") || "none"})`);

writeFileSync("data/seed-lists/fashion-ecommerce.json", JSON.stringify(fashion, null, 2));
writeFileSync("data/seed-lists/home-garden.json", JSON.stringify(home, null, 2));
console.log("written: data/seed-lists/fashion-ecommerce.json, data/seed-lists/home-garden.json");
