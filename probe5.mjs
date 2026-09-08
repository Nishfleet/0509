import { probeSneakerResaleDomain } from "./scripts/canary-sneaker-resale-recall.mjs";
const domains = ["goat.com","on.com","reebok.com","solesavy.com","sneakerping.com"];
for (const d of domains) {
  const p = await probeSneakerResaleDomain({ domain: d, baseUrl: "https://0509.io" });
  console.log(`${d.padEnd(16)} status=${p.status} rows=${p.rowCount} v=${p.tierCounts.verified} l=${p.tierCounts.likely} u=${p.tierCounts.unmatched} warming=${p.isWarming} headline=${p.headline}`);
}
