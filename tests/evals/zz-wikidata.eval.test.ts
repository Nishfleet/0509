import { parse } from "tldts";
import { describe, expect, it } from "vitest";

import { loadCases, type EvalRow } from "./harness";

interface Case extends EvalRow {
  self: { name: string; domain: string; description: string };
  expected: string[][];
}

const ENDPOINT = "https://query.wikidata.org/sparql";
const AGENT = "FiveToNineBot-eval/0.1 (https://0509.io; research)";
const TOP = 40;

function registrable(value: string): string {
  return parse(value).domain ?? value.toLowerCase();
}

async function sparql(query: string): Promise<Record<string, { value: string }>[]> {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": AGENT, Accept: "application/sparql-results+json" } });
    if (response.ok) {
      const body = (await response.json()) as { results: { bindings: Record<string, { value: string }>[] } };
      return body.results.bindings;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
  return [];
}

function websiteValues(domain: string): string {
  return ["https://", "http://"]
    .flatMap((scheme) => [
      `${scheme}${domain}`,
      `${scheme}${domain}/`,
      `${scheme}www.${domain}`,
      `${scheme}www.${domain}/`,
    ])
    .map((url) => `<${url}>`)
    .join(" ");
}

async function rivalsOf(domain: string): Promise<{ domains: string[]; industries: string[] }> {
  const query = `SELECT ?r ?site ?links ?indLabel WHERE {
    VALUES ?w { ${websiteValues(domain)} }
    ?self wdt:P856 ?w .
    ?self wdt:P452 ?ind .
    ?r wdt:P452 ?ind ; wdt:P856 ?site ; wikibase:sitelinks ?links .
    FILTER(?r != ?self)
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } ORDER BY DESC(?links) LIMIT 400`;
  const rows = await sparql(query);
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const row of rows) {
    const site = row.site?.value;
    if (site === undefined) continue;
    const found = registrable(new URL(site).hostname);
    if (seen.has(found)) continue;
    seen.add(found);
    domains.push(found);
  }
  return { domains, industries: [...new Set(rows.map((row) => row.indLabel?.value ?? ""))].slice(0, 5) };
}

describe("diag: wikidata same-industry candidates", () => {
  it("prints per-brand candidates and recall", async () => {
    const rows = await loadCases<Case>("proposer_recall", ["self", "expected"]);
    const totals: Record<string, { points: number; cases: number; found: number }> = {};
    for (const row of rows) {
      const { domains, industries } = await rivalsOf(row.self.domain);
      const top = new Set(domains.slice(0, TOP));
      const hits = row.expected.filter((aliases) => aliases.some((alias) => top.has(registrable(alias)))).length;
      const recall = hits / row.expected.length;
      const bucket = (totals[row.split] ??= { points: 0, cases: 0, found: 0 });
      bucket.points += recall;
      bucket.cases += 1;
      if (domains.length > 0) bucket.found += 1;
      console.log(
        `WD ${row.id} ${row.split} cands=${String(domains.length)} recall=${recall.toFixed(2)} ind=${industries.join("|")} top8=${domains.slice(0, 8).join(",")}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    for (const [split, bucket] of Object.entries(totals)) {
      console.log(
        `WD TOTAL ${split} cases=${String(bucket.cases)} withCandidates=${String(bucket.found)} meanRecall@${String(TOP)}=${(bucket.points / bucket.cases).toFixed(4)}`,
      );
    }
    expect(rows.length).toBeGreaterThan(0);
  });
  it("prints brands named by the customer's own pages", async () => {
    const rows = await loadCases<Case>("proposer_recall", ["self", "expected"]);
    const totals: Record<string, { points: number; cases: number; fetched: number }> = {};
    for (const row of rows) {
      const found = new Set<string>();
      let fetched = 0;
      for (const path of ["/", "/about", "/press", "/blog", "/alternatives", "/compare"]) {
        try {
          const response = await fetch(`https://${row.self.domain}${path}`, {
            headers: { "User-Agent": AGENT },
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) continue;
          fetched += 1;
          const html = (await response.text()).slice(0, 400000);
          for (const match of html.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
            found.add(registrable(match[1] ?? ""));
          }
        } catch {
          continue;
        }
      }
      const hits = row.expected.filter((aliases) => aliases.some((alias) => found.has(registrable(alias)))).length;
      const recall = hits / row.expected.length;
      const bucket = (totals[row.split] ??= { points: 0, cases: 0, fetched: 0 });
      bucket.points += recall;
      bucket.cases += 1;
      if (fetched > 0) bucket.fetched += 1;
      console.log(
        `OWN ${row.id} ${row.split} pages=${String(fetched)} hosts=${String(found.size)} recall=${recall.toFixed(2)}`,
      );
    }
    for (const [split, bucket] of Object.entries(totals)) {
      console.log(
        `OWN TOTAL ${split} cases=${String(bucket.cases)} fetched=${String(bucket.fetched)} meanRecall=${(bucket.points / bucket.cases).toFixed(4)}`,
      );
    }
    expect(rows.length).toBeGreaterThan(0);
  }, 900000);
});
