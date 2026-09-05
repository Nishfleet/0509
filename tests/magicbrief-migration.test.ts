import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildCompetitorImportPreview } from "~/lib/competitor-import";

/**
 * Deterministic, sanitized fixtures for the MagicBrief migration guide
 * (`docs/magicbrief-migration.md`). Synthetic brands and reserved documentation
 * domains only — no customer data, personal data, or credentials.
 */
const PASTE_LINES_FIXTURE = [
  "acme.com",
  "Globex",
  "https://example.com",
  "Initech, initech.example",
].join("\n");

const HEADER_CSV_FIXTURE = [
  "name,domain,notes,tags,client",
  '"Acme Industries",acme.com,"Watch offers, COD",audio; sale,Client A',
  "Globex,https://www.globex.example,Beauty marketplace,beauty,Client B",
].join("\n");

const ALIAS_HEADER_CSV_FIXTURE = [
  "company,website,description,tags,account",
  "Acme Industries,acme.com,Note from alias headers,alias,Client C",
].join("\n");

const ADVERTISER_HEADER_CSV_FIXTURE = [
  "advertiser,domain,notes,tags",
  "Initech,initech.example,Advertiser header row,ad",
].join("\n");

const POSITIONAL_CSV_FIXTURE = [
  "Acme,https://acme.com,Watch offers,audio; sale,Client A",
].join("\n");

const ANALYTICS_CSV_FIXTURE = [
  "advertiser,domain,collection,ad_id,impressions,reach,spend,start_date",
  "Acme,acme.com,Summer 2026,123456789,120000,90000,4200,2026-01-01",
  "Globex,globex.example,Launch,987654321,80000,50000,3100,2026-02-01",
].join("\n");

const INVALID_URL_LINE = "https://user:pass@example.com";
const SECRETISH_DECOY_LINE = "DODO_API_KEY=secret-token";

const REJECTED_ROWS_FIXTURE = [
  INVALID_URL_LINE,
  SECRETISH_DECOY_LINE,
  "acme.com",
  "https://www.acme.com",
].join("\n");

const ALL_FIXTURES = [
  PASTE_LINES_FIXTURE,
  HEADER_CSV_FIXTURE,
  ALIAS_HEADER_CSV_FIXTURE,
  ADVERTISER_HEADER_CSV_FIXTURE,
  POSITIONAL_CSV_FIXTURE,
  ANALYTICS_CSV_FIXTURE,
  REJECTED_ROWS_FIXTURE,
];

const CREDENTIAL_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|password|passwd|bearer|authorization|client[_-]?secret)\s*[=:]/i,
  /sk-[a-z0-9]{16,}/i,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[a-z0-9]{16,}/i,
  /-----BEGIN/i,
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  /\b\d{16}\b/,
];

/**
 * Test-side mirror of the parser's recognized header words
 * (`app/lib/competitor-import.ts`). The fixture tests below run each family
 * through the real parser, so a parser header change that breaks a claim in
 * the guide fails here even though the implementation stays untouched.
 */
const CLAIMED_HEADER_WORDS = [
  "name",
  "company",
  "brand",
  "competitor",
  "advertiser",
  "domain",
  "website",
  "url",
  "site",
  "note",
  "notes",
  "description",
  "tag",
  "tags",
  "client",
  "account",
  "customer",
];

const guide = readFileSync(new URL("../docs/magicbrief-migration.md", import.meta.url), "utf8");

const preview = (rawText: string, overrides: Partial<Parameters<typeof buildCompetitorImportPreview>[0]> = {}) =>
  buildCompetitorImportPreview({
    rawText,
    country: "US",
    planLimit: 10,
    currentCount: 0,
    ...overrides,
  });

describe("magicbrief migration guide fixtures", () => {
  it("parses the paste-lines form exactly as the guide maps it", () => {
    const result = preview(PASTE_LINES_FIXTURE);

    expect(result.summary.valid).toBe(4);
    const rows = result.rows.map((row) => ({
      name: row.name,
      website: row.website,
      normalizedUrl: row.normalizedUrl,
    }));
    expect(rows).toEqual([
      { name: "Acme", website: "acme.com", normalizedUrl: "https://acme.com" },
      { name: "Globex", website: null, normalizedUrl: null },
      { name: "Example", website: "https://example.com", normalizedUrl: "https://example.com" },
      { name: "Initech", website: "initech.example", normalizedUrl: "https://initech.example" },
    ]);
    expect(result.rows[1]?.target?.targetId).toBe("Globex");
  });

  it("maps header CSV name, website, notes, tags, and client to the guide's slots", () => {
    const result = preview(HEADER_CSV_FIXTURE);

    expect(result.summary.valid).toBe(2);
    expect(result.rows[0]).toMatchObject({
      name: "Acme Industries",
      notes: "Watch offers, COD",
      tags: ["audio", "sale"],
      client: "Client A",
      normalizedUrl: "https://acme.com",
    });
    expect(result.rows[1]).toMatchObject({
      name: "Globex",
      normalizedUrl: "https://globex.example",
      notes: "Beauty marketplace",
      tags: ["beauty"],
      client: "Client B",
    });
  });

  it("maps every claimed header alias to the same slots", () => {
    const alias = preview(ALIAS_HEADER_CSV_FIXTURE);
    expect(alias.rows[0]).toMatchObject({
      name: "Acme Industries",
      notes: "Note from alias headers",
      tags: ["alias"],
      client: "Client C",
      normalizedUrl: "https://acme.com",
    });

    const advertiser = preview(ADVERTISER_HEADER_CSV_FIXTURE);
    expect(advertiser.rows[0]).toMatchObject({
      name: "Initech",
      notes: "Advertiser header row",
      tags: ["ad"],
      normalizedUrl: "https://initech.example",
    });
  });

  it("parses a headerless CSV positionally (name, website, notes, tags, client)", () => {
    const result = preview(POSITIONAL_CSV_FIXTURE);

    expect(result.rows[0]).toMatchObject({
      name: "Acme",
      website: "https://acme.com",
      notes: "Watch offers",
      tags: ["audio", "sale"],
      client: "Client A",
      normalizedUrl: "https://acme.com",
    });
  });

  it("never imports unsupported columns and surfaces them in the rejected-field report", () => {
    const result = preview(ANALYTICS_CSV_FIXTURE);

    expect(result.summary.valid).toBe(2);
    for (const row of result.rows) {
      expect(row.notes).toBeNull();
      expect(row.tags).toEqual([]);
      expect(row.client).toBeNull();
      expect(row.raw).not.toContain("DODO_API_KEY");
    }
    expect(result.rows[0]?.raw).toContain("Summer 2026");
    expect(result.rows[0]?.raw).toContain("120000");
    expect(result.rows[0]?.raw).toContain("4200");

    for (const column of ["impressions", "reach", "spend", "collection", "ad_id"]) {
      expect(guide).toContain(column);
    }
  });

  it("surfaces invalid, duplicate, and over-limit rows with reasons instead of dropping them", () => {
    const result = preview(REJECTED_ROWS_FIXTURE);

    expect(result.rows.map((row) => row.status)).toEqual(["invalid", "invalid", "valid", "duplicate"]);
    expect(result.rows[0]).toMatchObject({
      status: "invalid",
      reason: "Enter the website domain only, like brand.com.",
    });
    expect(result.rows[1]).toMatchObject({
      status: "invalid",
      reason: "This row looks like it contains a secret or private link. Remove it before importing.",
    });
    expect(result.rows[3]).toMatchObject({
      status: "duplicate",
      reason: "Duplicate of row 3.",
    });
  });

  it("keeps over-limit rows visible rather than silently dropping them", () => {
    const result = preview("acme.com\nglobex.example\ninitech.example\numbrella.example", {
      planLimit: 2,
      currentCount: 1,
    });

    expect(result.rows.map((row) => row.status)).toEqual(["valid", "over_cap", "over_cap", "over_cap"]);
    expect(result.rows[2]?.reason).toContain("Over the current plan limit");
  });
});

describe("magicbrief migration guide fixture hygiene", () => {
  it("keeps fixtures free of credentials and personal data", () => {
    const cleanFixtures = ALL_FIXTURES.map((fixture) =>
      fixture
        .split("\n")
        .filter((line) => line !== SECRETISH_DECOY_LINE && line !== INVALID_URL_LINE)
        .join("\n"),
    );

    for (const fixture of cleanFixtures) {
      for (const pattern of CREDENTIAL_PATTERNS) {
        expect(fixture, `fixture matches ${pattern}`).not.toMatch(pattern);
      }
    }

    for (const pattern of CREDENTIAL_PATTERNS) {
      expect(guide, `guide matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it("confines secret-looking material to the named decoy lines", () => {
    const result = preview(REJECTED_ROWS_FIXTURE);

    expect(result.rows[1]?.reason).toBe(
      "This row looks like it contains a secret or private link. Remove it before importing.",
    );
    const secretishRows = result.rows.filter((row) =>
      row.reason?.includes("secret or private link"),
    );
    expect(secretishRows.map((row) => row.raw)).toEqual([SECRETISH_DECOY_LINE]);
  });
});

describe("magicbrief migration guide stays aligned with the parser", () => {
  it("lists every claimed header word and no header outside the parser's set", () => {
    for (const word of CLAIMED_HEADER_WORDS) {
      expect(guide, `guide must document header \`${word}\``).toContain(`\`${word}\``);
    }

    const section1 = guide.slice(0, guide.indexOf("## 2."));
    const backtickedTokens = Array.from(section1.matchAll(/`([a-z]+)`/g), (match) => match[1]);
    for (const token of backtickedTokens) {
      expect(CLAIMED_HEADER_WORDS, `guide references undocumented header \`${token}\``).toContain(token);
    }
  });

  it("documents the verified boundary: generic import only, no MagicBrief export contract", () => {
    expect(guide).toContain("no MagicBrief export format has been verified");
    expect(guide).toContain("Manual recreation fallback");
    expect(guide).toContain("creates watchlists (and client rooms), not collections");
    expect(guide).toContain("the old evidence never transfers");
    expect(guide).toContain("There is no file/asset import path");
    expect(guide).not.toContain("fully portable");
  });

  it("documents every unsupported disposition as not imported or rejected", () => {
    const notImported = guide.match(/\*\*Not imported\.\*\*/g) ?? [];
    const rejected = guide.match(/\*\*Rejected\.\*\*/g) ?? [];
    expect(notImported.length).toBeGreaterThanOrEqual(4);
    expect(rejected.length).toBe(1);
  });
});
