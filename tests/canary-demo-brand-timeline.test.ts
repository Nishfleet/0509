import { describe, expect, it } from "vitest";

import {
  ISSUE_BODY_MARKER,
  buildCorpusQuery,
  buildGhIssueCommand,
  buildIssueBody,
  canonicalUrlBelongsToDomain,
  countRowsPerBrand,
  parseArgs,
  rowsFromWranglerJson,
  validateBrandCounts,
} from "../scripts/canary-demo-brand-timeline.mjs";

describe("canary-demo-brand-timeline (#1449)", () => {
  describe("parseArgs", () => {
    it("returns defaults for an empty argv", () => {
      expect(parseArgs([])).toEqual({
        local: false,
        json: false,
        fileIssue: false,
        dryRun: false,
      });
    });

    it("accepts --local, --json, --file-issue, --dry-run", () => {
      expect(parseArgs(["--local", "--json", "--file-issue", "--dry-run"])).toEqual({
        local: true,
        json: true,
        fileIssue: true,
        dryRun: true,
      });
    });

    it("throws on an unknown flag", () => {
      expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
    });
  });

  describe("buildCorpusQuery", () => {
    it("is a read-only corpus query with no DML", () => {
      const sql = buildCorpusQuery();
      expect(sql).toMatch(/SELECT canonical_url FROM landing_page_snapshot/);
      expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|DROP|ALTER/i);
    });
  });

  describe("canonicalUrlBelongsToDomain", () => {
    it("matches bare, www, and subdomain hosts", () => {
      expect(canonicalUrlBelongsToDomain("https://nike.com/", "nike.com")).toBe(true);
      expect(canonicalUrlBelongsToDomain("https://www.nike.com/", "nike.com")).toBe(true);
      expect(canonicalUrlBelongsToDomain("https://store.nike.com/shoes", "nike.com")).toBe(true);
    });

    it("rejects lookalike and unrelated hosts", () => {
      expect(canonicalUrlBelongsToDomain("https://nike.com.evil.example/", "nike.com")).toBe(false);
      expect(canonicalUrlBelongsToDomain("https://nikeshoes.example/", "nike.com")).toBe(false);
      expect(canonicalUrlBelongsToDomain("https://www.adidas.com/", "nike.com")).toBe(false);
      expect(canonicalUrlBelongsToDomain("not a url", "nike.com")).toBe(false);
      expect(canonicalUrlBelongsToDomain("", "nike.com")).toBe(false);
    });
  });

  describe("countRowsPerBrand", () => {
    it("counts the five demo brands and ignores unrelated rows", () => {
      const counts = countRowsPerBrand([
        { canonical_url: "https://www.nike.com/" },
        { canonical_url: "https://www.nykaa.com/" },
        { canonical_url: "https://www.allbirds.com/" },
        { canonical_url: "https://www.lenskart.com/" },
        { canonical_url: "https://www.mamaearth.com/" },
        { canonical_url: "https://www.adidas.com/" },
        { canonical_url: null },
      ]);
      expect(counts).toEqual({
        "nike.com": 1,
        "nykaa.com": 1,
        "allbirds.com": 1,
        "lenskart.com": 1,
        "mamaearth.com": 1,
      });
    });

    it("handles a completely empty corpus with every brand at 0", () => {
      const counts = countRowsPerBrand([]);
      expect(Object.values(counts).every((n) => n === 0)).toBe(true);
      expect(validateBrandCounts(counts).verdict).toBe("fail");
    });
  });

  describe("validateBrandCounts", () => {
    it("passes when every watched brand has >= 1 row", () => {
      const counts = Object.fromEntries(
        ["nike.com", "nykaa.com", "allbirds.com", "lenskart.com", "mamaearth.com"].map(
          (domain) => [domain, 3],
        ),
      );
      const validation = validateBrandCounts(counts);
      expect(validation.verdict).toBe("pass");
      expect(validation.failures).toEqual([]);
    });

    it("fails when any single watched brand drops to 0", () => {
      const counts = Object.fromEntries(
        ["nike.com", "nykaa.com", "allbirds.com", "lenskart.com", "mamaearth.com"].map(
          (domain) => [domain, domain === "nykaa.com" ? 0 : 3],
        ),
      );
      const validation = validateBrandCounts(counts);
      expect(validation.verdict).toBe("fail");
      expect(validation.failures).toHaveLength(1);
      expect(validation.failures[0]).toContain("nykaa.com");
    });
  });

  describe("rowsFromWranglerJson", () => {
    it("accepts the bare results[] shape", () => {
      const rows = rowsFromWranglerJson(
        JSON.stringify([{ results: [{ canonical_url: "https://www.nike.com/" }] }]),
      );
      expect(rows).toEqual([{ canonical_url: "https://www.nike.com/" }]);
    });

    it("accepts the nested success/meta shape wrangler returns", () => {
      const rows = rowsFromWranglerJson(
        JSON.stringify([{ success: true, result: { results: [{ canonical_url: "https://www.mamaearth.com/" }] } }]),
      );
      expect(rows).toEqual([{ canonical_url: "https://www.mamaearth.com/" }]);
    });
  });

  describe("issue filing", () => {
    it("builds a gh issue create command for the incident", () => {
      const command = buildGhIssueCommand({
        body: "body",
        title: "title",
        repo: "Nishfleet/0509",
      });
      expect(command).toEqual(["issue", "create", "-R", "Nishfleet/0509", "--title", "title", "--body", "body"]);
    });

    it("builds a body carrying counts, the checked-at stamp, and the dedupe marker", () => {
      const body = buildIssueBody({
        counts: { "nike.com": 4, "nykaa.com": 0, "allbirds.com": 2, "lenskart.com": 1, "mamaearth.com": 1 },
        checkedAt: "2026-09-05T09:37:00.000Z",
        failures: ["landing_page_snapshot count for watched demo brand nykaa.com dropped to 0."],
      });
      expect(body).toContain(ISSUE_BODY_MARKER);
      expect(body).toContain("`nykaa.com`: 0");
      expect(body).toContain("2026-09-05T09:37:00.000Z");
      expect(body).toContain("`nike.com`: 4");
    });
  });
});