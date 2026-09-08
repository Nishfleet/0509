import { probeSneakerResaleDomain } from "./scripts/canary-sneaker-resale-recall.mjs";
const p = await probeSneakerResaleDomain({ domain: "solesavy.com", baseUrl: "https://0509.io" });
console.log(`solesavy.com status=${p.status} rows=${p.rowCount} v=${p.tierCounts.verified} l=${p.tierCounts.likely} u=${p.tierCounts.unmatched} warming=${p.isWarming} headline=${p.headline}`);
