import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isSecretishMemoryString } from "~/lib/agent-redaction";
import {
  buildCompetitorImportPreview,
  COMPETITOR_IMPORT_ACCEPTED_HEADERS,
  COMPETITOR_IMPORT_MAX_BYTES,
  COMPETITOR_IMPORT_MAX_ROWS,
} from "~/lib/competitor-import";

const GUIDE_PATH = "docs/magicbrief-migration.md";

const PASTE_FIXTURE = [
  "northstar-shoes.com",
  "https://harbor-tea.shop",
  "Lumen Desk",
].join("\n");

const HEADERED_CSV_FIXTURE = [
  "name,website,notes,tags,client",
  "Aurora Coffee,aurora-coffee.com,Monthly offer rotations,coffee;roast,Retail Group",
  "Maple Ledger,https://maple-ledger.com,Watch pricing page,finance,Client A",
].join("\n");

const ALIAS_CSV_FIXTURE = [
  "company,domain,note,tags,account",
  "Willow Sofas,willow-sofas.com,Focus on seat fabric,home;furniture,North Star Retail",
].join("\n");

const POSITIONAL_CSV_FIXTURE = [
  "Trail Works,trailworks.com,Backpack line,hiking;outdoor,West Coast Gear",
].join("\n");

const MAGICBRIEF_CSV_FIXTURE = [
  "name,website,note,tags,client,spend,impressions,reach,campaign_name,collection,screenshot_url",
  "Aurora Coffee,aurora-coffee.com,Campaign notes,coffee,Retail Group,12500,450000,120000,Spring Launch,Spring Campaign,https://storage.example.com/evidence/aurora-01.png",
].join("\n");

const ROW_OUTCOME_FIXTURE = [
  "northstar-shoes.com",
  "https://northstar-shoes.com",
  "https://not-a-domain",
  "harbor-tea.shop",
].join("\n");

const ALL_FIXTURES = [
  PASTE_FIXTURE,
  HEADERED_CSV_FIXTURE,
  ALIAS_CSV_FIXTURE,
  POSITIONAL_CSV_FIXTURE,
  MAGICBRIEF_CSV_FIXTURE,
  ROW_OUTCOME_FIXTURE,
];

const REJECTED_FIELD_NAMES = [
  "spend",
  "impressions",
  "reach",
  "campaign_name",
  "collection",
  "screenshot_url",
];

const REJECTED_FIELD_VALUES = [
  "12500",
  "450000",
  "120000",
  "Spring Launch",
  "Spring Campaign",
  "https://storage.example.com/evidence/aurora-01.png",
];

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN = /\b\+?[0-9][0-9 -]{9,}[0-9]\b/;
const URL_USERINFO_PATTERN = /:\/\/[^\s/]+@/;

function previewFor(rawText: string, planLimit: number, currentCount = 0) {
  return buildCompetitorImportPreview({
    rawText,
    country: "US",
    planLimit,
    currentCount,
  });
}

function parsedFieldText(row: {
  name: string | null;
  website: string | null;
  normalizedUrl: string | null;
  host: string | null;
  notes: string | null;
  tags: string[];
  client: string | null;
  target: { targetLabel: string; targetId: string } | null;
}) {
  return [
    row.name,
    row.website,
    row.normalizedUrl,
    row.host,
    row.notes,
    row.client,
    ...row.tags,
    row.target?.targetLabel ?? "",
    row.target?.targetId ?? "",
  ].filter(Boolean).join("\n");
}

describe("magicbrief-migration fixtures", () => {
  it("sanitized fixtures contain no secrets, no PII, and no credential-shaped text", () => {
    for (const fixture of ALL_FIXTURES) {
      expect(isSecretishMemoryString(fixture), `fixture flagged by the secret detector`).toBe(false);
      expect(fixture, "fixture contains an email address").not.toMatch(EMAIL_PATTERN);
      expect(fixture, "fixture contains a phone number").not.toMatch(PHONE_PATTERN);
      expect(fixture, "fixture contains URL credentials").not.toMatch(URL_USERINFO_PATTERN);
      expect(fixture.trim(), "fixture is empty").not.toBe("");
    }
  });

  it("paste fixture parses a domain, a URL, and a plain name", () => {
    const preview = previewFor(PASTE_FIXTURE, 5);

    expect(preview.error).toBeNull();
    expect(preview.summary.valid).toBe(3);
    expect(preview.rows.map((row) => row.status)).toEqual(["valid", "valid", "valid"]);
    expect(preview.rows.map((row) => row.normalizedUrl)).toEqual([
      "https://northstar-shoes.com",
      "https://harbor-tea.shop",
      null,
    ]);
    expect(preview.rows[0]?.host).toBe("northstar-shoes.com");
    expect(preview.rows[1]?.host).toBe("harbor-tea.shop");
    expect(preview.rows[2]).toMatchObject({
      name: "Lumen Desk",
      website: null,
      normalizedUrl: null,
      target: {
        targetType: "advertiser",
        targetId: "Lumen Desk",
        targetLabel: "Lumen Desk",
      },
    });
  });

  it("header CSV fixture maps every supported column", () => {
    const preview = previewFor(HEADERED_CSV_FIXTURE, 5);

    expect(preview.summary.valid).toBe(2);
    expect(preview.rows[0]).toMatchObject({
      name: "Aurora Coffee",
      website: "aurora-coffee.com",
      normalizedUrl: "https://aurora-coffee.com",
      notes: "Monthly offer rotations",
      tags: ["coffee", "roast"],
      client: "Retail Group",
    });
    expect(preview.rows[1]).toMatchObject({
      name: "Maple Ledger",
      website: "https://maple-ledger.com",
      normalizedUrl: "https://maple-ledger.com",
      notes: "Watch pricing page",
      tags: ["finance"],
      client: "Client A",
    });
  });

  it("every documented alias header maps to the same field", () => {
    for (const header of ["name", "company", "brand", "competitor", "advertiser"]) {
      const preview = previewFor(`${header},website\nAurora Coffee,aurora-coffee.com`, 5);
      expect(preview.rows[0]?.status, `header ${header}`).toBe("valid");
      expect(preview.rows[0]?.name, `header ${header}`).toBe("Aurora Coffee");
    }

    for (const header of ["domain", "website", "url", "site"]) {
      const preview = previewFor(`name,${header}\nAurora Coffee,aurora-coffee.com`, 5);
      expect(preview.rows[0]?.status, `header ${header}`).toBe("valid");
      expect(preview.rows[0]?.website, `header ${header}`).toBe("aurora-coffee.com");
      expect(preview.rows[0]?.normalizedUrl, `header ${header}`).toBe("https://aurora-coffee.com");
    }

    for (const header of ["note", "notes", "description"]) {
      const preview = previewFor(`name,${header}\nAurora Coffee,Monthly offer rotations`, 5);
      expect(preview.rows[0]?.notes, `header ${header}`).toBe("Monthly offer rotations");
    }

    for (const header of ["tag", "tags"]) {
      const preview = previewFor(`name,${header}\nAurora Coffee,coffee;roast`, 5);
      expect(preview.rows[0]?.tags, `header ${header}`).toEqual(["coffee", "roast"]);
    }

    for (const header of ["client", "account", "customer"]) {
      const preview = previewFor(`name,${header}\nAurora Coffee,Retail Group`, 5);
      expect(preview.rows[0]?.client, `header ${header}`).toBe("Retail Group");
    }
  });

  it("positional CSV fixture maps name, website, notes, tags, client", () => {
    const preview = previewFor(POSITIONAL_CSV_FIXTURE, 5);

    expect(preview.summary.valid).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      name: "Trail Works",
      website: "trailworks.com",
      normalizedUrl: "https://trailworks.com",
      notes: "Backpack line",
      tags: ["hiking", "outdoor"],
      client: "West Coast Gear",
    });
  });
});

describe("magicbrief-migration rejected-field report", () => {
  it("reports every unsupported column in preview.rejectedFields and never imports its values", () => {
    const preview = previewFor(MAGICBRIEF_CSV_FIXTURE, 5);

    expect(preview.error).toBeNull();
    expect(preview.rejectedFields).toEqual(REJECTED_FIELD_NAMES);
    expect(preview.summary.valid).toBe(1);
    const row = preview.rows[0];
    expect(row?.status).toBe("valid");

    const importedText = parsedFieldText(row);
    for (const value of REJECTED_FIELD_VALUES) {
      expect(importedText, `rejected value reached an imported field: ${value}`).not.toContain(value);
    }

    expect(row?.raw).toContain("12500");
    expect(row?.raw).toContain("450000");
    expect(row?.raw).toContain("https://storage.example.com/evidence/aurora-01.png");
    expect(row?.raw).toContain("Spring Campaign");

    expect(row).toMatchObject({
      name: "Aurora Coffee",
      website: "aurora-coffee.com",
      normalizedUrl: "https://aurora-coffee.com",
      notes: "Campaign notes",
      tags: ["coffee"],
      client: "Retail Group",
    });
  });

  it("headerless CSV overflow columns are reported positionally", () => {
    const preview = previewFor("Trail Works,trailworks.com,Backpack line,hiking,West Coast Gear,extra,one-more", 5);

    expect(preview.rejectedFields).toEqual(["column 6", "column 7"]);
  });

  it("invalid, duplicate, and over-cap rows are surfaced with reasons, never silently dropped", () => {
    const preview = previewFor(ROW_OUTCOME_FIXTURE, 3);

    expect(preview.summary).toMatchObject({
      valid: 2,
      invalid: 1,
      duplicate: 1,
      existing: 0,
      over_cap: 0,
    });
    expect(preview.rows.map((row) => row.status)).toEqual(["valid", "duplicate", "invalid", "valid"]);
    expect(preview.rows.map((row) => row.selected)).toEqual([true, false, false, true]);
    expect(preview.rows[1]?.reason).toBe("Duplicate of row 1.");
    expect(preview.rows[2]?.reason).toBe("That website looks incomplete. Add the full domain, like brand.com.");
    expect(preview.rows.map((row) => row.raw)).toEqual([
      "northstar-shoes.com",
      "https://northstar-shoes.com",
      "https://not-a-domain",
      "harbor-tea.shop",
    ]);

    const capped = previewFor(ROW_OUTCOME_FIXTURE, 1);
    expect(capped.summary.over_cap).toBe(1);
    expect(capped.rows[3]).toMatchObject({
      status: "over_cap",
      selected: false,
      reason: "Over the current plan limit. Select fewer competitors or upgrade.",
    });
    expect(capped.selectedCount).toBe(1);
  });
});

describe("magicbrief-migration guide alignment", () => {
  const guide = readFileSync(GUIDE_PATH, "utf8");

  it("the guide documents every parser-accepted header", () => {
    for (const header of COMPETITOR_IMPORT_ACCEPTED_HEADERS) {
      expect(guide, `guide does not document accepted header: ${header}`).toContain(header);
    }
  });

  it("the guide documents every fixture-exercised rejected field", () => {
    for (const field of REJECTED_FIELD_NAMES) {
      expect(guide, `guide does not list rejected field: ${field}`).toContain(field);
    }
  });

  it("the guide states the parser's real limits", () => {
    expect(guide).toContain(`${Math.floor(COMPETITOR_IMPORT_MAX_BYTES / 1000)} KB`);
    expect(guide).toContain(`${COMPETITOR_IMPORT_MAX_ROWS} rows`);
    expect(guide).toContain("10 tags");
  });

  it("the guide states the truthful boundary and the manual fallback", () => {
    expect(guide).toMatch(/no real MagicBrief export fixture/i);
    expect(guide).toContain("not imported");
    expect(guide).toContain("retained by the customer or manually recreated");
    expect(guide).toContain("Manual fallback");
  });

  it("the guide names preview.rejectedFields as the data contract and the current UI limitation", () => {
    expect(guide).toContain("preview.rejectedFields");
    expect(guide).toContain("does not yet render");
  });
});
