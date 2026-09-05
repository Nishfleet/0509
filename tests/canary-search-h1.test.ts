import { describe, expect, it } from "vitest";

import {
  BANNED_SCOPE_PHRASES,
  SEARCH_H1_DOMAINS,
  buildGhIssueCommand,
  buildIssueBody,
  buildSearchUrl,
  extractSearchH1,
  findExistingOpenIncident,
  gradeSearchH1,
  h1ContainsBannedPhrase,
  parseArgs,
  validateSearchH1s,
} from "../scripts/canary-search-h1.mjs";

describe("canary-search-h1 (#1502)", () => {
  describe("parseArgs", () => {
    it("returns defaults for an empty argv", () => {
      expect(parseArgs([])).toEqual({ fileIssue: false, dryRun: false });
    });

    it("accepts --file-issue and --dry-run", () => {
      expect(parseArgs(["--file-issue", "--dry-run"])).toEqual({
        fileIssue: true,
        dryRun: true,
      });
    });

    it("throws on an unknown flag", () => {
      expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
    });
  });

  describe("extractSearchH1", () => {
    it("extracts the inner text of the first H1, lowercased", () => {
      expect(extractSearchH1("<h1>What Nike is running on Meta</h1>")).toBe(
        "what nike is running on meta",
      );
    });

    it("strips nested tags and lowercases (no entity decoding needed for the banned-phrase verdict)", () => {
      expect(
        extractSearchH1("<h1><span>What Oura</span> is running on Meta</h1>"),
      ).toBe("what oura is running on meta");
    });

    it("returns null when no H1 is rendered", () => {
      expect(extractSearchH1("<html><body>no heading here</body></html>")).toBeNull();
    });
  });

  describe("gradeSearchH1", () => {
    it("passes plain buyer-language copy without a banned phrase", () => {
      const result = gradeSearchH1({
        domain: "nike",
        h1: "What Nike is running on Meta",
      });
      expect(result.verdict).toBe("pass");
      expect(result.failures).toEqual([]);
    });

    it("fails on the technical all-countries scope phrase", () => {
      const result = gradeSearchH1({
        domain: "nike",
        h1: "Nike ads across all countries",
      });
      expect(result.verdict).toBe("fail");
      expect(result.failures[0]).toMatch(/banned phrase "across all countries"/);
    });

    it("fails on the all-countries query phrase", () => {
      const result = gradeSearchH1({
        domain: "notion",
        h1: "Notion ads all-countries query",
      });
      expect(result.verdict).toBe("fail");
      expect(result.failures[0]).toMatch(/banned phrase "all-countries query"/);
    });

    it("skips (never passes) when no H1 is rendered", () => {
      const result = gradeSearchH1({ domain: "nike", h1: null });
      expect(result.verdict).toBe("skip");
      expect(result.failures).toEqual([]);
    });
  });

  describe("h1ContainsBannedPhrase", () => {
    it("matches case-insensitively", () => {
      expect(
        h1ContainsBannedPhrase({
          domain: "nike",
          phrase: "across all countries",
          h1: "NIKE ADS ACROSS ALL COUNTRIES",
        }),
      ).toBe(true);
    });
  });

  describe("validateSearchH1s", () => {
    const pass = (domain: string) => gradeSearchH1({ domain, h1: `What ${domain} is running on Meta` });

    it("passes when every domain renders buyer-language H1", () => {
      const results = SEARCH_H1_DOMAINS.map((d) => ({ domain: d, ...pass(d), h1: pass(d).observed }));
      const validation = validateSearchH1s({ results });
      expect(validation.verdict).toBe("pass");
      expect(validation.failures).toEqual([]);
    });

    it("fails when any domain regresses to the all-countries phrase", () => {
      const results = SEARCH_H1_DOMAINS.map((d, i) => {
        if (d === "notion") return { domain: d, ...gradeSearchH1({ domain: d, h1: "Notion ads across all countries" }), h1: "notion ads across all countries" };
        return { domain: d, ...pass(d), h1: pass(d).observed };
      });
      const validation = validateSearchH1s({ results });
      expect(validation.verdict).toBe("fail");
      expect(validation.failuresByDomain["notion"]).toBeTruthy();
      expect(validation.failures.length).toBeGreaterThan(0);
    });
  });

  describe("buildSearchUrl", () => {
    it("builds the /search URL from the domain", () => {
      expect(buildSearchUrl({ domain: "nykaa.com" })).toBe("https://0509.io/search?q=nykaa.com");
    });
    it("URL-encodes the domain", () => {
      expect(buildSearchUrl({ domain: "nykaa " })).toBe("https://0509.io/search?q=nykaa%20");
    });
  });

  describe("buildGhIssueCommand", () => {
    it("builds a gh issue create argv against Nishfleet/0509", () => {
      const command = buildGhIssueCommand({
        body: "body",
        title: "title",
        repo: "Nishfleet/0509",
      });
      expect(command).toEqual(["issue", "create", "-R", "Nishfleet/0509", "--title", "title", "--body", "body"]);
    });
  });

  describe("buildIssueBody", () => {
    it("carries the failed domains, observed H1s, and write-path link (accept criterion 4)", () => {
      const body = buildIssueBody({
        checkedAt: "2026-09-05T00:00:00Z",
        failuresByDomain: {
          notion: ['/search?q=notion H1 contains banned phrase "across all countries": "notion ads across all countries"'],
        },
        observedByDomain: { notion: "notion ads across all countries", nike: "what nike is running on meta" },
      });
      expect(body).toMatch(/across all countries/);
      expect(body).toMatch(/app\/routes\/search\.tsx/);
      expect(body).toMatch(/search-h1-guard-incident: true, domains:/);
    });
  });

  describe("findExistingOpenIncident", () => {
    it("returns existing:false when gh is unavailable or nothing open (no throw)", () => {
      // Runs in the test harness; if gh finds nothing the guard degrades to
      // existing:false so the canary can still attempt to file. It must not
      // throw for an empty result.
      expect(typeof findExistingOpenIncident({ repo: "Nishfleet/0509" }).existing).toBe("boolean");
    });
  });
});
