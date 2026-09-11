import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMELINE_ORIGIN,
  ISSUE_BODY_MARKER,
  TIMELINE_AS_OF_MARKER,
  TIMELINE_LEDGER_ENTRY_MARKER,
  buildCorpusQuery,
  buildGhIssueCommand,
  buildHttpIssueBody,
  buildIssueBody,
  buildTimelineUrl,
  canonicalUrlBelongsToDomain,
  countRowsPerBrand,
  parseArgs,
  rowsFromWranglerJson,
  validateBrandCounts,
  validateTimelineProbe,
} from "../scripts/canary-demo-brand-timeline.mjs";

describe("canary-demo-brand-timeline (#1449)", () => {
  describe("parseArgs", () => {
    it("returns defaults for an empty argv", () => {
      expect(parseArgs([])).toEqual({
        local: false,
        json: false,
        fileIssue: false,
        dryRun: false,
        http: false,
        origin: DEFAULT_TIMELINE_ORIGIN,
      });
    });

    it("accepts --local, --json, --file-issue, --dry-run, --http", () => {
      expect(
        parseArgs(["--local", "--json", "--file-issue", "--dry-run", "--http"]),
      ).toEqual({
        local: true,
        json: true,
        fileIssue: true,
        dryRun: true,
        http: true,
        origin: DEFAULT_TIMELINE_ORIGIN,
      });
    });

    it("accepts --origin <url> and strips trailing slashes", () => {
      expect(parseArgs(["--http", "--origin", "http://127.0.0.1:4179/"])).toEqual({
        local: false,
        json: false,
        fileIssue: false,
        dryRun: false,
        http: true,
        origin: "http://127.0.0.1:4179",
      });
    });

    it("throws when --origin has no value", () => {
      expect(() => parseArgs(["--origin"])).toThrow(/--origin requires a value/);
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

  describe("--http mode (issue #1899)", () => {
    describe("buildTimelineUrl", () => {
      it("builds the public timeline URL for a demo brand", () => {
        expect(buildTimelineUrl("https://0509.io", "nike.com")).toBe(
          "https://0509.io/timeline/nike.com",
        );
      });

      it("strips trailing slashes from the origin", () => {
        expect(buildTimelineUrl("http://127.0.0.1:4179/", "allbirds.com")).toBe(
          "http://127.0.0.1:4179/timeline/allbirds.com",
        );
      });

      it("encodes the domain", () => {
        expect(buildTimelineUrl("https://0509.io", "lenskart.com")).toBe(
          "https://0509.io/timeline/lenskart.com",
        );
      });
    });

    describe("validateTimelineProbe", () => {
      it("passes on HTTP 200 with the As-of affordance and a rendered ledger entry", () => {
        const verdict = validateTimelineProbe({
          domain: "nike.com",
          status: 200,
          body: `<input type="date" name="asOf" /> ${TIMELINE_AS_OF_MARKER} <ol class="f9-timeline-ledger"><li class="${TIMELINE_LEDGER_ENTRY_MARKER}"><time>5 Sept 2026</time></li></ol>`,
        });
        expect(verdict).toEqual({ verdict: "pass", reason: null });
      });

      it("fails on HTTP 410 — the proof-gate dark state", () => {
        const verdict = validateTimelineProbe({
          domain: "nike.com",
          status: 410,
          body: "This page is gone",
        });
        expect(verdict.verdict).toBe("fail");
        expect(verdict.reason).toContain("410");
        expect(verdict.reason).toContain("nike.com");
      });

      it("fails on HTTP 500", () => {
        const verdict = validateTimelineProbe({
          domain: "nykaa.com",
          status: 500,
          body: "",
        });
        expect(verdict.verdict).toBe("fail");
        expect(verdict.reason).toContain("500");
      });

      it("fails on a 200 that renders the empty shell (no As-of marker)", () => {
        const verdict = validateTimelineProbe({
          domain: "mamaearth.com",
          status: 200,
          body: "No stored snapshots yet. Once monitoring captures this landing page, the dated ledger lands here.",
        });
        expect(verdict.verdict).toBe("fail");
        expect(verdict.reason).toContain("ledger is empty");
      });

      it("fails on a 200 that carries the As-of label but no rendered dated state (D1 read-failure shell)", () => {
        const verdict = validateTimelineProbe({
          domain: "nykaa.com",
          status: 200,
          body: `${TIMELINE_AS_OF_MARKER} <label for="offer-timeline-asof">As of</label> <p class="f9-timeline-empty">No stored snapshots yet.</p>`,
        });
        expect(verdict.verdict).toBe("fail");
        expect(verdict.reason).toContain(TIMELINE_LEDGER_ENTRY_MARKER);
      });
    });

    describe("buildHttpIssueBody", () => {
      it("builds a body carrying per-brand statuses, the marker, and the checked-at stamp", () => {
        const body = buildHttpIssueBody({
          results: [
            { domain: "nike.com", status: 410 },
            { domain: "nykaa.com", status: 410 },
            { domain: "allbirds.com", status: 200 },
            { domain: "lenskart.com", status: 200 },
            { domain: "mamaearth.com", status: 410 },
          ],
          checkedAt: "2026-09-07T11:40:04.000Z",
          failures: [
            "/timeline/nike.com returned 410 — no proofbearing snapshot.",
            "/timeline/nykaa.com returned 410 — no proofbearing snapshot.",
          ],
        });
        expect(body).toContain(ISSUE_BODY_MARKER);
        expect(body).toContain("`nike.com`: HTTP 410");
        expect(body).toContain("`allbirds.com`: HTTP 200");
        expect(body).toContain("2026-09-07T11:40:04.000Z");
        expect(body).toContain("issue #1899 guard");
      });
    });
  });
});