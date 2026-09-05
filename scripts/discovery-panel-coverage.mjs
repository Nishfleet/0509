#!/usr/bin/env node
/**
 * Discovery-panel coverage reporter.
 *
 * Panel is identical to discovery-spike-v2 (12 domains). A domain is covered
 * when its public `/search?website=` path returned ≥1 ad.
 *
 * Usage:
 *   node scripts/discovery-panel-coverage.mjs --print-panel
 *   node scripts/discovery-panel-coverage.mjs --from-json path/to/results.json [--out report.md] [--gate 8]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const PANEL = [
  "allbirds.com",
  "notion.so",
  "ouraring.com",
  "nykaa.com",
  "gymshark.com",
  "hubspot.com",
  "ridgewallet.com",
  "bombayshavingcompany.com",
  "curofy.com",
  "mailchimp.com",
  "canva.com",
  "plausible.io",
];

function score(rows) {
  const byDomain = new Map(rows.map((row) => [row.domain, Number(row.adCount) || 0]));
  const perDomain = PANEL.map((domain) => {
    const adCount = byDomain.get(domain) ?? 0;
    return { domain, adCount, covered: adCount >= 1 };
  });
  return {
    covered: perDomain.filter((row) => row.covered).length,
    total: perDomain.length,
    perDomain,
  };
}

function render(coverage, generatedAt = new Date().toISOString(), note = "") {
  const lines = [
    "# Discovery panel coverage",
    "",
    `Generated: ${generatedAt}`,
    `Covered: ${coverage.covered}/${coverage.total}`,
    "",
    "| Domain | Ads | Covered |",
    "|---|---:|:---:|",
    ...coverage.perDomain.map(
      (row) => `| ${row.domain} | ${row.adCount} | ${row.covered ? "yes" : "no"} |`,
    ),
  ];
  if (note) {
    lines.push("", note);
  }
  return `${lines.join("\n")}\n`;
}

const { values } = parseArgs({
  options: {
    "print-panel": { type: "boolean", default: false },
    "from-json": { type: "string" },
    out: { type: "string" },
    gate: { type: "string" },
    note: { type: "string" },
  },
  allowPositionals: false,
});

if (values["print-panel"]) {
  process.stdout.write(`${PANEL.join("\n")}\n`);
  process.exit(0);
}

if (!values["from-json"]) {
  process.stderr.write(
    "usage: discovery-panel-coverage.mjs --print-panel | --from-json <file> [--out report.md] [--gate 8]\n",
  );
  process.exit(2);
}

const parsed = JSON.parse(readFileSync(values["from-json"], "utf8"));
const rows = Array.isArray(parsed) ? parsed : parsed.domains;
if (!Array.isArray(rows)) {
  process.stderr.write("JSON must be an array of {domain, adCount} or {domains: [...]}\n");
  process.exit(2);
}

const coverage = score(rows);
const report = render(coverage, parsed.generatedAt, values.note ?? parsed.note ?? "");
if (values.out) {
  writeFileSync(values.out, report);
} else {
  process.stdout.write(report);
}

const gate = values.gate ? Number(values.gate) : null;
if (Number.isFinite(gate) && coverage.covered < gate) {
  process.stderr.write(`coverage ${coverage.covered}/${coverage.total} is below gate ${gate}\n`);
  process.exit(1);
}
