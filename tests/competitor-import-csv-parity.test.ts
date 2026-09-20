import { describe, expect, it } from "vitest";

import { buildCompetitorImportPreview } from "~/lib/competitor-import";

/**
 * Byte-parity fixtures for the papaparse CSV swap (issue #3781). These pin
 * the behaviors the hand-rolled parser used to provide where they are
 * load-bearing: comma-bearing quoted cells, quoted newlines, doubled quotes
 * inside quoted cells, CRLF line endings, and whitespace-only row dropping.
 */
describe("competitor import CSV byte-parity (papaparse swap)", () => {
  it("keeps quoted commas inside cells across all mapped columns", () => {
    const preview = buildCompetitorImportPreview({
      rawText: [
        'name,website,notes,tags,client',
        '"Brand, Incorporated",brand-inc.test,"Budget, plus VAT",tag a; tag b,"Group, North"',
      ].join("\n"),
      country: "US",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.error).toBeNull();
    expect(preview.rows[0]).toMatchObject({
      name: "Brand, Incorporated",
      notes: "Budget, plus VAT",
      tags: ["tag a", "tag b"],
      client: "Group, North",
    });
  });

  it("keeps quoted newlines inside a cell as one row", () => {
    const preview = buildCompetitorImportPreview({
      rawText: 'name,notes\n"Multiline\nBrand","line one\nline two"\n',
      country: "US",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.error).toBeNull();
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({
      name: "Multiline Brand",
      notes: "line one line two",
    });
  });

  it("unescapes doubled quotes inside quoted cells", () => {
    const preview = buildCompetitorImportPreview({
      rawText: 'name,notes\n"Handmade ""Luxe"" Goods",note',
      country: "US",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.error).toBeNull();
    expect(preview.rows[0]).toMatchObject({
      name: 'Handmade "Luxe" Goods',
      notes: "note",
    });
  });

  it("parses CRLF-terminated CSV the same as LF", () => {
    const preview = buildCompetitorImportPreview({
      rawText: "name,website\r\nNykaa,https://www.nykaa.com\r\nBoat,boat-lifestyle.com\r\n",
      country: "IN",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.error).toBeNull();
    expect(preview.rows.map((row) => row.name)).toEqual(["Nykaa", "Boat"]);
  });

  it("drops whitespace-only records instead of counting them as rows", () => {
    const preview = buildCompetitorImportPreview({
      rawText: "a.com\n\n   \n\t\nb.com\n",
      country: "US",
      planLimit: 10,
      currentCount: 0,
    });

    expect(preview.summary.valid).toBe(2);
    expect(preview.rows).toHaveLength(2);
  });
});
