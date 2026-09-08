import { describe, expect, it } from "vitest";

import {
  buildCtaEventCountQuery,
  mapCtaDetectorRow,
  parseArgs,
  rowsFromWranglerJson,
  validateCtaDetector,
} from "../scripts/canary-cta-detector.mjs";

describe("canary-cta-detector (#1500)", () => {
  describe("parseArgs", () => {
    it("returns defaults for an empty argv", () => {
      expect(parseArgs([])).toEqual({
        local: false,
        json: false,
        windowDays: 7,
        watchlistCohort: 25,
      });
    });

    it("accepts --local, --json, --window-days, and --watchlist-cohort", () => {
      expect(
        parseArgs([
          "--local",
          "--json",
          "--window-days",
          "14",
          "--watchlist-cohort",
          "50",
        ]),
      ).toEqual({
        local: true,
        json: true,
        windowDays: 14,
        watchlistCohort: 50,
      });
    });

    it("ignores non-positive window and cohort values", () => {
      expect(
        parseArgs(["--window-days", "0", "--watchlist-cohort", "-1"]),
      ).toMatchObject({
        windowDays: 7,
        watchlistCohort: 25,
      });
    });

    it("throws on an unknown flag", () => {
      expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
    });
  });

  describe("buildCtaEventCountQuery", () => {
    it("filters on landing_page_cta_changed and the requested window-days", () => {
      const sql = buildCtaEventCountQuery(7);
      expect(sql).toMatch(
        /event_type = 'landing_page_cta_changed'/,
      );
      expect(sql).toMatch(
        /datetime\('now', '-' \|\| 7 \|\| ' days'\)/,
      );
      expect(sql).toMatch(/FROM watch_event/);
    });

    it("accepts a different window and embeds it as an integer", () => {
      const sql = buildCtaEventCountQuery(30);
      expect(sql).toMatch(
        /datetime\('now', '-' \|\| 30 \|\| ' days'\)/,
      );
    });
  });

  describe("rowsFromWranglerJson", () => {
    it("unwraps the array-of-results shape from wrangler", () => {
      const output = JSON.stringify([
        {
          results: [
            { cta_event_count: 4, active_watchlist_count: 28 },
          ],
          success: true,
        },
      ]);
      expect(rowsFromWranglerJson(output)).toEqual([
        { cta_event_count: 4, active_watchlist_count: 28 },
      ]);
    });

    it("returns [] for an empty string", () => {
      expect(rowsFromWranglerJson("")).toEqual([]);
    });
  });

  describe("mapCtaDetectorRow", () => {
    it("normalises the four scalar fields", () => {
      expect(
        mapCtaDetectorRow([
          {
            cta_event_count: 3,
            active_watchlist_count: 28,
            first_cta_event_at: "2026-09-01 10:00:00",
            last_cta_event_at: "2026-09-02 12:00:00",
          },
        ]),
      ).toEqual({
        ctaEventCount: 3,
        activeWatchlistCount: 28,
        firstCtaEventAt: "2026-09-01 10:00:00",
        lastCtaEventAt: "2026-09-02 12:00:00",
      });
    });

    it("returns null for an empty row set", () => {
      expect(mapCtaDetectorRow([])).toBeNull();
    });
  });

  describe("validateCtaDetector", () => {
    it("passes when at least 1 CTA event is in the window", () => {
      expect(
        validateCtaDetector({
          windowDays: 7,
          watchlistCohort: 25,
          row: {
            ctaEventCount: 1,
            activeWatchlistCount: 25,
            firstCtaEventAt: "2026-09-01 10:00:00",
            lastCtaEventAt: "2026-09-01 10:00:00",
          },
        }),
      ).toEqual({
        ok: true,
        failures: [],
      });
    });

    it("fails when zero CTA events are in the window", () => {
      const result = validateCtaDetector({
        windowDays: 7,
        watchlistCohort: 25,
        row: {
          ctaEventCount: 0,
          activeWatchlistCount: 25,
          firstCtaEventAt: null,
          lastCtaEventAt: null,
        },
      });
      expect(result.ok).toBe(false);
      expect(result.failures.join(" ")).toMatch(/silent CTA detector/);
    });

    it("fails when the query returned no rows", () => {
      const result = validateCtaDetector({
        windowDays: 7,
        watchlistCohort: 25,
        row: null,
      });
      expect(result.ok).toBe(false);
      expect(result.failures.join(" ")).toMatch(/no rows/);
    });
  });
});
