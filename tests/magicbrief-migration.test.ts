import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildCompetitorImportPreview } from "~/lib/competitor-import";

const GUIDE_PATH = "docs/magicbrief-migration.md";

const ACCEPTED_HEADER_ALIASES = {
  name: ["name", "company", "brand", "competitor", "advertiser"],
  website: ["domain", "website", "url", "site"],
  notes: ["note", "notes", "description"],
  tags: ["tag", "tags"],
  client: ["client", "account", "customer"],
} as const;

const REJECTED_FIXTURE_COLUMNS = ["board", "analytics_impressions", "analytics_spend", "report_date"];

const FIXTURE_PASTED_LINES = [
  "auroraactivewear.com",
  "https://bluepeakfoods.com/shop",
  "Northwind Trail",
].join("\n");

const FIXTURE_FULL_CSV = [
  "name,domain,notes,tags,client",
  '"Aurora Activewear",auroraactivewear.com,"Spring launch tracking",sportswear; athleisure,Client A',
  "Blue Peak Foods,bluepeakfoods.com,Frozen line refresh,packaging,Client B",
].join("\n");

const FIXTURE_MAGICBRIEF_LIKE_CSV = [
  "name,website,notes,tags,client,board,analytics_impressions,analytics_spend,report_date",
  '"Aurora Activewear",auroraactivewear.com,"Spring launch tracking",sportswear; athleisure,Client A,Brand Board,2048,9.99,2026-07-15',
  "Blue Peak Foods,bluepeakfoods.com,Frozen line refresh,packaging,Client B,Product Board,,,",
].join("\n");

const FIXTURE_MIXED_ROWS = [
  "auroraactivewear.com",
  "auroraactivewear.com",
  "https://user:pass@example.com",
  "DODO_API_KEY=secret-token",
].join("\n");

const SANITIZED_FIXTURES = [
  FIXTURE_PASTED_LINES,
  FIXTURE_FULL_CSV,
  FIXTURE_MAGICBRIEF_LIKE_CSV,
];

function previewFor(rawText: string) {
  return buildCompetitorImportPreview({
    rawText,
    country: "US",
    planLimit: 10,
    currentCount: 0,
  });
}

describe("MagicBrief migration fixtures exercise the real parser", () => {
  it("parses pasted domains, URLs, and brand names as supported input", () => {
    const preview = previewFor(FIXTURE_PASTED_LINES);

    expect(preview.error).toBeNull();
    expect(preview.summary.valid).toBe(3);
    expect(preview.rejectedColumns).toEqual([]);
    expect(preview.rows.map((row) => row.target?.targetId)).toEqual([
      "https://auroraactivewear.com",
      "https://bluepeakfoods.com/shop",
      "Northwind Trail",
    ]);
  });

  it("parses CSV rows with every supported header and maps name, website, notes, tags, and client", () => {
    const preview = previewFor(FIXTURE_FULL_CSV);

    expect(preview.error).toBeNull();
    expect(preview.summary.valid).toBe(2);
    expect(preview.rejectedColumns).toEqual([]);
    expect(preview.rows[0]).toMatchObject({
      name: "Aurora Activewear",
      normalizedUrl: "https://auroraactivewear.com",
      notes: "Spring launch tracking",
      tags: ["sportswear", "athleisure"],
      client: "Client A",
      status: "valid",
    });
    expect(preview.rows[1]?.client).toBe("Client B");
  });

  it("surfaces unsupported MagicBrief-like columns in a rejected-field report without silently discarding them", () => {
    const preview = previewFor(FIXTURE_MAGICBRIEF_LIKE_CSV);

    expect(preview.error).toBeNull();
    expect(preview.summary.valid).toBe(2);
    expect(preview.rejectedColumns).toEqual(REJECTED_FIXTURE_COLUMNS);
    expect(preview.rows[0]?.raw).toContain("Brand Board");
    expect(preview.rows[0]?.raw).toContain("2048");
    expect(preview.rows[0]?.raw).toContain("9.99");
    expect(preview.rows[0]?.raw).toContain("2026-07-15");
    expect(preview.rows[1]?.raw).toContain("Product Board");
  });

  it("flags invalid and duplicate rows instead of silently dropping them", () => {
    const preview = previewFor(FIXTURE_MIXED_ROWS);

    expect(preview.summary).toMatchObject({
      valid: 1,
      duplicate: 1,
      invalid: 2,
    });
    expect(preview.rows.map((row) => row.status)).toEqual([
      "valid",
      "duplicate",
      "invalid",
      "invalid",
    ]);
    expect(preview.rows[2]?.reason).toBe("Enter the website domain only, like brand.com.");
    expect(preview.rows[3]?.reason).toBe(
      "This row looks like it contains a secret or private link. Remove it before importing.",
    );
  });
});

describe("the guide stays aligned with the parser's real accepted fields", () => {
  it("documents every header alias the parser accepts, and each alias actually parses", () => {
    const guide = readFileSync(GUIDE_PATH, "utf8");

    for (const aliases of Object.values(ACCEPTED_HEADER_ALIASES)) {
      for (const alias of aliases) {
        expect(guide).toContain(`\`${alias}\``);
      }
    }

    for (const alias of ACCEPTED_HEADER_ALIASES.name) {
      const preview = previewFor(`domain,${alias}\nbluepeakfoods.com,Blue Peak Foods`);
      expect(preview.rows[0]?.name).toBe("Blue Peak Foods");
      expect(preview.rejectedColumns).toEqual([]);
    }
    for (const alias of ACCEPTED_HEADER_ALIASES.website) {
      const preview = previewFor(`${alias},name\nbluepeakfoods.com,Blue Peak Foods`);
      expect(preview.rows[0]?.normalizedUrl).toBe("https://bluepeakfoods.com");
      expect(preview.rejectedColumns).toEqual([]);
    }
    for (const alias of ACCEPTED_HEADER_ALIASES.notes) {
      const preview = previewFor(`domain,${alias}\nbluepeakfoods.com,Spring launch tracking`);
      expect(preview.rows[0]?.notes).toBe("Spring launch tracking");
      expect(preview.rejectedColumns).toEqual([]);
    }
    for (const alias of ACCEPTED_HEADER_ALIASES.tags) {
      const preview = previewFor(`domain,${alias}\nbluepeakfoods.com,packaging; frozen`);
      expect(preview.rows[0]?.tags).toEqual(["packaging", "frozen"]);
      expect(preview.rejectedColumns).toEqual([]);
    }
    for (const alias of ACCEPTED_HEADER_ALIASES.client) {
      const preview = previewFor(`domain,${alias}\nbluepeakfoods.com,Client B`);
      expect(preview.rows[0]?.client).toBe("Client B");
      expect(preview.rejectedColumns).toEqual([]);
    }
  });

  it("documents the rejected fixture columns and the unsupported MagicBrief data without promising full migration", () => {
    const guide = readFileSync(GUIDE_PATH, "utf8");

    for (const column of REJECTED_FIXTURE_COLUMNS) {
      expect(guide).toContain(column);
    }
    expect(guide).toContain("analytics/report history");
    expect(guide).toContain("collections and boards");
    expect(guide).toContain("not imported");
    expect(guide).toContain("No full MagicBrief export contract is verified");
    expect(guide).toContain("Manual fallback");
    expect(guide).toContain("keep your original");
  });

  it("documents the rejected-column preview panel and the preview.rejectedColumns data contract", () => {
    const guide = readFileSync(GUIDE_PATH, "utf8");

    expect(guide).toContain("`preview.rejectedColumns`");
    expect(guide).toContain("row-level statuses");
    expect(guide).toContain("proof-safe record");
    expect(guide).toContain("Columns not imported");
  });

  it("documents the manual-fallback import preview path without the old panel limitation", () => {
    const guide = readFileSync(GUIDE_PATH, "utf8");

    expect(guide).toContain("rejected columns");
    expect(guide).not.toContain("no dedicated rejected-column panel");
  });

  it("documents the exact supported input forms and limits", () => {
    const guide = readFileSync(GUIDE_PATH, "utf8");

    for (const phrase of [
      "one competitor per line",
      "CSV",
      "file upload",
      "positionally",
      "200 KB",
      "250 rows",
      "rejected",
      "never silently dropped",
    ]) {
      expect(guide).toContain(phrase);
    }
  });
});

describe("fixtures and guide are sanitized", () => {
  it("contains no secrets or PII in the guide or the clean fixtures", () => {
    const guide = readFileSync(GUIDE_PATH, "utf8");
    const content = [guide, ...SANITIZED_FIXTURES].join("\n");

    const secretOrPiiPatterns = [
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
      /\b\+?[0-9]{10,}\b/,
      /BEGIN [A-Z ]*PRIVATE KEY/,
      /\b(?:sk|rk|pk)_[A-Za-z0-9]{10,}\b/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
      /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
      /\b(?:DODO|WRANGLER|CLOUDFLARE|GOOGLE_CLIENT|MICROSOFT_CLIENT|BETTER_AUTH|SUPABASE|OPENAI|ANTHROPIC)[A-Z0-9_]*\s*=\s*[^\s]{4,}/i,
      /\bpassword\s*[:=]\s*\S+/i,
      /\bsecret[-_ ]?token\b/i,
      /\bapi[_-]?key\s*[:=]\s*\S+/i,
    ];

    for (const pattern of secretOrPiiPatterns) {
      expect(content.match(pattern)).toBeNull();
    }
  });
});
