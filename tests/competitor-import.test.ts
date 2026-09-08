import { describe, expect, it } from "vitest";

import { buildCompetitorImportPreview } from "~/lib/competitor-import";

describe("buildCompetitorImportPreview", () => {
  it("parses pasted domains and auto-selects rows within the plan cap", () => {
    const preview = buildCompetitorImportPreview({
      rawText: "nykaa.com\nhttps://boat-lifestyle.com\nmamaearth.in",
      country: "IN",
      planLimit: 3,
      currentCount: 0,
    });

    expect(preview.error).toBeNull();
    expect(preview.summary.valid).toBe(3);
    expect(preview.selectedCount).toBe(3);
    expect(preview.rows.map((row) => row.target?.targetId)).toEqual([
      "https://nykaa.com",
      "https://boat-lifestyle.com",
      "https://mamaearth.in",
    ]);
  });

  it("accepts plain competitor names as advertiser targets", () => {
    const preview = buildCompetitorImportPreview({
      rawText: "MagicBrief\nForeplay",
      country: "US",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.summary.valid).toBe(2);
    expect(preview.rows[0]?.normalizedUrl).toBeNull();
    expect(preview.rows[0]?.target).toMatchObject({
      targetId: "MagicBrief",
      targetLabel: "MagicBrief",
      targetType: "advertiser",
      targetCountry: "US",
    });
  });

  it("parses generic CSV headers with notes, tags, and client grouping", () => {
    const preview = buildCompetitorImportPreview({
      rawText: [
        "name,domain,notes,tags,client",
        '"Boat Lifestyle",boat-lifestyle.com,"Watch offers, COD",audio; sale,Client A',
        "Nykaa,https://www.nykaa.com,Beauty marketplace,beauty,Client B",
      ].join("\n"),
      country: "IN",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.summary.valid).toBe(2);
    expect(preview.rows[0]).toMatchObject({
      name: "Boat Lifestyle",
      notes: "Watch offers, COD",
      tags: ["audio", "sale"],
      client: "Client A",
      normalizedUrl: "https://boat-lifestyle.com",
    });
    expect(preview.rows[1]?.normalizedUrl).toBe("https://nykaa.com");
  });

  it("does not treat a single-column CSV header as a competitor", () => {
    const preview = buildCompetitorImportPreview({
      rawText: "name\nBoat Lifestyle\nNoise",
      country: "all",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.summary.valid).toBe(2);
    expect(preview.rows.map((row) => row.name)).toEqual(["Boat Lifestyle", "Noise"]);
    expect(preview.rows.map((row) => row.raw)).not.toContain("name");
  });

  it("deduplicates exact and www variants before plan-cap selection", () => {
    const preview = buildCompetitorImportPreview({
      rawText: "https://www.nykaa.com\nnykaa.com\nboat-lifestyle.com",
      country: "IN",
      planLimit: 2,
      currentCount: 0,
    });

    expect(preview.summary.valid).toBe(2);
    expect(preview.summary.duplicate).toBe(1);
    expect(preview.rows[1]).toMatchObject({
      status: "duplicate",
      reason: "Duplicate of row 1.",
      selected: false,
    });
    expect(preview.selectedCount).toBe(2);
  });

  it("marks existing watchlists separately from duplicate import rows", () => {
    const existing = buildCompetitorImportPreview({
      rawText: "nykaa.com",
      country: "IN",
      planLimit: 3,
      currentCount: 0,
    }).rows[0]?.target?.targetFingerprint;

    const preview = buildCompetitorImportPreview({
      rawText: "nykaa.com\nboat-lifestyle.com",
      country: "IN",
      planLimit: 3,
      currentCount: 1,
      existingFingerprints: existing ? [existing] : [],
    });

    expect(preview.summary.existing).toBe(1);
    expect(preview.summary.valid).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      status: "existing",
      selected: false,
    });
    expect(preview.selectedCount).toBe(1);
  });

  it("marks rows over the remaining plan cap without silently dropping them", () => {
    const preview = buildCompetitorImportPreview({
      rawText: "a.com\nb.com\nc.com\nd.com",
      country: "US",
      planLimit: 3,
      currentCount: 1,
    });

    expect(preview.availableSlots).toBe(2);
    expect(preview.summary.valid).toBe(2);
    expect(preview.summary.over_cap).toBe(2);
    expect(preview.rows.map((row) => row.status)).toEqual(["valid", "valid", "over_cap", "over_cap"]);
  });

  it("honors explicit selected row ids while enforcing available slots", () => {
    const preview = buildCompetitorImportPreview({
      rawText: "a.com\nb.com\nc.com",
      country: "US",
      planLimit: 2,
      currentCount: 0,
      selectedRowIds: ["row-2", "row-3"],
    });

    expect(preview.selectedCount).toBe(2);
    expect(preview.rows.map((row) => row.selected)).toEqual([false, true, true]);
    expect(preview.rows.map((row) => row.status)).toEqual(["valid", "valid", "valid"]);
  });

  it("rejects invalid URLs and secret-looking pasted rows", () => {
    const preview = buildCompetitorImportPreview({
      rawText: "https://user:pass@example.com\nDODO_API_KEY=secret-token\nvalidbrand.com",
      country: "US",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.summary.invalid).toBe(2);
    expect(preview.summary.valid).toBe(1);
    expect(preview.rows[0]?.reason).toBe("Enter the website domain only, like brand.com.");
    expect(preview.rows[1]?.reason).toBe("This row looks like it contains a secret or private link. Remove it before importing.");
  });

  it("rejects oversized and over-row-limit imports", () => {
    expect(buildCompetitorImportPreview({
      rawText: "a".repeat(101),
      country: "US",
      planLimit: 10,
      currentCount: 0,
      maxBytes: 100,
    }).error).toContain("Import is too large");

    expect(buildCompetitorImportPreview({
      rawText: "a.com\nb.com\nc.com",
      country: "US",
      planLimit: 10,
      currentCount: 0,
      maxRows: 2,
    }).error).toContain("2 rows or fewer");
  });
});
