import { describe, expect, it } from "vitest";

import {
  BANNED_ERROR_SHELL_PHRASES,
  BASE_URL,
  BRAND_DOMAIN,
  HONEST_COPY_MARKERS,
  MAX_REQUESTS,
  buildBrandPageUrl,
  buildGhIssueCommand,
  buildIssueBody,
  findExistingOpenIncident,
  gradeRateLimitResponse,
  parseArgs,
} from "../scripts/canary-public-brand-page-rate-limit.mjs";

describe("canary-public-brand-page-rate-limit (#1930)", () => {
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

  describe("buildBrandPageUrl", () => {
    it("builds the /ads URL from the domain", () => {
      expect(buildBrandPageUrl({ domain: "nike.com" })).toBe(
        "https://0509.io/ads/nike.com",
      );
    });
    it("URL-encodes the domain", () => {
      expect(buildBrandPageUrl({ domain: "nike com" })).toBe(
        "https://0509.io/ads/nike%20com",
      );
    });
  });

  describe("gradeRateLimitResponse", () => {
    it("passes a tripped 429 with the honest copy and Retry-After", () => {
      const grade = gradeRateLimitResponse({
        status: 429,
        body: "Too many requests — You've hit the anonymous preview limit. Free preview allows 120 page loads per 10 minutes — wait a few minutes and try again.",
        retryAfter: "600",
      });
      expect(grade.tripped).toBe(true);
      expect(grade.honest).toBe(true);
      expect(grade.genericShell).toBe(false);
      expect(grade.hasRetryAfter).toBe(true);
    });

    it("fails when the generic error shell reappears in a 429 body", () => {
      const grade = gradeRateLimitResponse({
        status: 429,
        body: "Something went wrong — Something broke on our side loading this page.",
        retryAfter: "600",
      });
      expect(grade.tripped).toBe(true);
      expect(grade.honest).toBe(false);
      expect(grade.genericShell).toBe(true);
    });

    it("fails when Retry-After is dropped", () => {
      const grade = gradeRateLimitResponse({
        status: 429,
        body: "You've hit the anonymous preview limit. Free preview allows 120 page loads per 10 minutes — wait a few minutes and try again.",
        retryAfter: null,
      });
      expect(grade.tripped).toBe(true);
      expect(grade.honest).toBe(true);
      expect(grade.hasRetryAfter).toBe(false);
    });

    it("is not tripped for a 200 response", () => {
      const grade = gradeRateLimitResponse({
        status: 200,
        body: "<html>normal page</html>",
        retryAfter: null,
      });
      expect(grade.tripped).toBe(false);
    });
  });

  describe("constants", () => {
    it("pins the honest copy markers and banned shell phrases", () => {
      expect(HONEST_COPY_MARKERS).toContain("anonymous preview limit");
      expect(HONEST_COPY_MARKERS).toContain("120 page loads per 10 minutes");
      expect(BANNED_ERROR_SHELL_PHRASES).toContain("Something broke on our side");
      expect(BASE_URL).toBe("https://0509.io");
      expect(BRAND_DOMAIN).toBe("nike.com");
      expect(MAX_REQUESTS).toBeGreaterThan(120);
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
    it("carries the observed status, honest/generic flags, Retry-After, and write-path link", () => {
      const body = buildIssueBody({
        checkedAt: "2026-09-07T00:00:00Z",
        status: 429,
        honest: false,
        genericShell: true,
        hasRetryAfter: false,
        body: "Something went wrong — Something broke on our side loading this page.",
      });
      expect(body).toMatch(/Something broke on our side/);
      expect(body).toMatch(/app\/routes\/ads\.\$domain\.tsx/);
      expect(body).toMatch(/public-brand-page-rate-limit-guard-incident: true/);
    });
  });

  describe("findExistingOpenIncident", () => {
    it("returns existing:false when gh is unavailable or nothing open (no throw)", () => {
      expect(typeof findExistingOpenIncident({ repo: "Nishfleet/0509" }).existing).toBe("boolean");
    });
  });
});
