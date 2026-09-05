import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isSecretishMemoryString } from "~/lib/agent-redaction";
import {
  buildCompetitorImportPreview,
  COMPETITOR_IMPORT_ACCEPTED_HEADERS,
} from "~/lib/competitor-import";

/**
 * Sanitized inline fixtures for the MagicBrief migration guide. Every brand,
 * domain, note, tag, and number below is invented — no PII, no real customer
 * data, no secrets. The `magicBriefLikeCsv` fixture deliberately mirrors the
 * *generic* competitor-list shape the parser accepts (advertiser/domain/
 * notes/tags/client) plus analytics-style columns (spend, reach, impressions,
 * last_seen) that the generic importer cannot preserve.
 */
const FIXTURES = {
  pastedLines: [
    "aurora-retail.example",
    "https://nimbus-labs.example.com",
    "Driftwood Co",
  ].join("\n"),

  genericCsv: [
    "name,domain,notes,tags,client",
    '"Aurora Retail",aurora-retail.example,"Tracks festival offers",festival; retail,client-alpha',
    'Nimbus Labs,https://nimbus-labs.example.com,"Enterprise trials",b2b,client-beta',
  ].join("\n"),

  magicBriefLikeCsv: [
    "advertiser,domain,notes,tags,client,spend,reach,impressions,last_seen",
    '"Aurora Retail",aurora-retail.example,"Offer changes",discount; festival,client-alpha,"12,450",120000,89000,2026-07-28',
    'Nimbus Labs,nimbus-labs.example,"New landing page",b2b,client-beta,9800,45000,31000,2026-07-28',
  ].join("\n"),

  headerlessCsvWithExtraColumn: [
    "Aurora Retail,aurora-retail.example,notes-value,tag-one,client-alpha,extra-cell",
  ].join("\n"),

  invalidAndDuplicateRows: [
    "x",
    "https://www.aurora-retail.example",
    "aurora-retail.example",
  ].join("\n"),
};

function guideText() {
  return readFileSync(new URL("../docs/magicbrief-migration.md", import.meta.url), "utf8");
}

const SECRET_OR_PII_PATTERNS = [
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
  /\b\d{10}\b/,
  /\b(?:sk|rk)_(?:live|test)_[a-z0-9]{12,}\b/i,
  /\bsk-[a-z0-9]{8,}\b/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[a-z0-9]{8,}\b/i,
  /\bgithub_pat_[a-z0-9]{8,}\b/i,
  /\bxox[baprs]-[a-z0-9-]+\b/i,
  /\bbearer\s+[a-z0-9._~+/=-]+\b/i,
  /\bwhsec_[a-z0-9]{12,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/i,
  /\bDODO_[A-Z_]+=\S+/i,
  /\bpassword\s*[:=]/i,
];

describe("MagicBrief migration fixtures", () => {
  it("pasted one-per-line fixture parses into ready website competitors", () => {
    const preview = buildCompetitorImportPreview({
      rawText: FIXTURES.pastedLines,
      country: "US",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.error).toBeNull();
    expect(preview.summary.valid).toBe(3);
    expect(preview.selectedCount).toBe(3);
    expect(preview.rows.map((row) => row.target?.targetId)).toEqual([
      "https://aurora-retail.example",
      "https://nimbus-labs.example.com",
      "Driftwood Co",
    ]);
    expect(preview.rows[2]?.normalizedUrl).toBeNull();
    expect(preview.rejectedFields).toEqual([]);
  });

  it("generic CSV fixture maps name, website, notes, tags, and client", () => {
    const preview = buildCompetitorImportPreview({
      rawText: FIXTURES.genericCsv,
      country: "IN",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.summary.valid).toBe(2);
    expect(preview.rejectedFields).toEqual([]);
    expect(preview.rows[0]).toMatchObject({
      name: "Aurora Retail",
      notes: "Tracks festival offers",
      tags: ["festival", "retail"],
      client: "client-alpha",
      normalizedUrl: "https://aurora-retail.example",
    });
    expect(preview.rows[1]?.client).toBe("client-beta");
  });

  it("surfaces unsupported MagicBrief-like columns in a rejected-field report", () => {
    const preview = buildCompetitorImportPreview({
      rawText: FIXTURES.magicBriefLikeCsv,
      country: "US",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.summary.valid).toBe(2);
    expect(preview.rejectedFields).toEqual(["spend", "reach", "impressions", "last_seen"]);
    expect(preview.rejectedFields.every((field) => !COMPETITOR_IMPORT_ACCEPTED_HEADERS.includes(field)))
      .toBe(true);
    expect(preview.rows[0]).toMatchObject({
      name: "Aurora Retail",
      notes: "Offer changes",
      tags: ["discount", "festival"],
      client: "client-alpha",
    });
  });

  it("reports positional columns beyond name/website/notes/tags/client as rejected", () => {
    const preview = buildCompetitorImportPreview({
      rawText: FIXTURES.headerlessCsvWithExtraColumn,
      country: "US",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.summary.valid).toBe(1);
    expect(preview.rejectedFields).toEqual(["column 6"]);
    expect(preview.rows[0]).toMatchObject({
      name: "Aurora Retail",
      notes: "notes-value",
      tags: ["tag-one"],
      client: "client-alpha",
    });
  });

  it("keeps invalid and duplicate rows visible instead of silently dropping them", () => {
    const preview = buildCompetitorImportPreview({
      rawText: FIXTURES.invalidAndDuplicateRows,
      country: "US",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.rows).toHaveLength(3);
    expect(preview.summary.invalid).toBe(1);
    expect(preview.summary.duplicate).toBe(1);
    expect(preview.summary.valid).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      status: "invalid",
      selected: false,
    });
    expect(preview.rows[0]?.reason).toBe("Add a competitor name, domain, or URL.");
    expect(preview.rows[2]).toMatchObject({
      status: "duplicate",
      reason: "Duplicate of row 2.",
      selected: false,
    });
  });
});

describe("MagicBrief migration guide alignment", () => {
  it("documents every header alias the parser actually accepts", () => {
    const guide = guideText();

    expect(COMPETITOR_IMPORT_ACCEPTED_HEADERS.length).toBeGreaterThan(10);
    for (const header of COMPETITOR_IMPORT_ACCEPTED_HEADERS) {
      expect(guide, `guide must document the accepted header \`${header}\``).toContain(`\`${header}\``);
    }
  });

  it("keeps the guide's truth markers for unsupported data and manual fallback", () => {
    const guide = guideText();

    expect(guide).toMatch(/no verified full (?:magicbrief )?export contract/i);
    expect(guide).toMatch(/rejected fields/i);
    expect(guide).toMatch(/manual/i);
    expect(guide).toMatch(/analytics/i);
    expect(guide).toMatch(/keep your (?:original )?(?:export|file)/i);
  });

  it("lists analytics/report history and saved evidence as not imported", () => {
    const guide = guideText();

    for (const field of ["spend", "reach", "impressions", "screenshots"]) {
      expect(guide, `guide must call out \`${field}\` as not imported`).toMatch(
        new RegExp(`${field}[^\\n]*not imported|not imported[^\\n]*${field}`, "i"),
      );
    }
  });
});

describe("MagicBrief migration fixture hygiene", () => {
  it("fixtures contain no secrets or PII", () => {
    const fixtureText = Object.values(FIXTURES).join("\n");

    for (const pattern of SECRET_OR_PII_PATTERNS) {
      expect(pattern.exec(fixtureText), `fixture must not match ${pattern}`).toBeNull();
    }
  });

  it("every fixture row passes the product's own secretish-string rejection", () => {
    const lines = Object.values(FIXTURES).flatMap((fixture) => fixture.split("\n"));
    for (const line of lines) {
      if (!line.trim()) continue;
      expect(isSecretishMemoryString(line), `row must be importable: ${line}`).toBe(false);
    }
  });
});
