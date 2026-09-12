import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  COVERAGE_FLOOR,
  INITIAL_COVERED,
  coverageVerdict,
  entriesFromSitemapXml,
} from "../scripts/canary-timeline-coverage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "canary-timeline-coverage.mjs");

const BASELINE_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>/ads/nike.com</loc></url>
<url><loc>/ads/zara.com</loc></url>
<url><loc>/timeline/nike.com</loc></url>
<url><loc>/timeline/</loc></url>
<url><loc>/guides/how-to-track-competitor-ads</loc></url>
</urlset>`;

function pathList(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => `${prefix}/d${i}.com`);
}

function writeFixture(xml: string) {
  const dir = mkdtempSync(join(tmpdir(), "tl-coverage-"));
  const path = join(dir, "sitemap.xml");
  writeFileSync(path, xml);
  return path;
}

describe("canary-timeline-coverage — sitemap parsing", () => {
  it("counts only bare /ads/:domain and /timeline/:domain locs", () => {
    const entries = entriesFromSitemapXml(BASELINE_SITEMAP);
    expect(entries.ads).toEqual(["/ads/nike.com", "/ads/zara.com"]);
    expect(entries.timeline).toEqual(["/timeline/nike.com"]);
  });

  it("supports absolute <loc> URLs from the live sitemap", () => {
    const entries = entriesFromSitemapXml(
      `<url><loc>https://0509.io/ads/nike.com</loc></url>` +
        `<url><loc>https://0509.io/timeline/nike.com</loc></url>`,
    );
    expect(entries.ads).toEqual(["/ads/nike.com"]);
    expect(entries.timeline).toEqual(["/timeline/nike.com"]);
  });

  it("ignores /ads/ child pages (receipts) and the /timeline/ index", () => {
    const entries = entriesFromSitemapXml(
      `<url><loc>/ads/nike.com/receipts</loc></url><url><loc>/timeline/</loc></url>`,
    );
    expect(entries.ads).toEqual([]);
    expect(entries.timeline).toEqual([]);
  });
});

describe("canary-timeline-coverage — issue #3095 termination rule", () => {
  it("the seeded baseline (7 covered of 91 /ads/, 2026-09-12 observation) is pending, not a regression", () => {
    const verdict = coverageVerdict({
      ads: pathList(91, "/ads"),
      timeline: pathList(7, "/timeline"),
    });
    expect(verdict.verdict).toBe("pending");
    expect(verdict.floorCount).toBe(73);
  });

  it("passes once coverage clears the 80% floor above the baseline", () => {
    const verdict = coverageVerdict({
      ads: pathList(91, "/ads"),
      timeline: pathList(80, "/timeline"),
    });
    expect(verdict.verdict).toBe("pass");
  });

  it("a rise only to the exact baseline count is pending, not a pass", () => {
    const verdict = coverageVerdict({
      ads: pathList(8, "/ads"),
      timeline: pathList(7, "/timeline"),
    });
    expect(verdict.verdict).toBe("pending");
  });

  it("uses ceil so 72 covered URLs of 91 is pending (0.8 * 91 = 72.8)", () => {
    expect(coverageVerdict({ ads: pathList(91, "/ads"), timeline: pathList(72, "/timeline") }).verdict).toBe("pending");
    expect(coverageVerdict({ ads: pathList(91, "/ads"), timeline: pathList(73, "/timeline") }).verdict).toBe("pass");
  });

  it("a degenerate sitemap is a REGRESSION — indexed proof pages vanished (< 7 covered)", () => {
    expect(coverageVerdict({ ads: [], timeline: [] }).verdict).toBe("regression");
  });

  it("the regression/pending boundary sits exactly at the seeded baseline", () => {
    // 6 covered of 91: below the 7-domain seeded baseline — the guard must
    // alarm, not observe.
    expect(coverageVerdict({ ads: pathList(91, "/ads"), timeline: pathList(6, "/timeline") }).verdict).toBe("regression");
    // 7 covered of 91: baseline held — pending (observe), never alarm.
    expect(coverageVerdict({ ads: pathList(91, "/ads"), timeline: pathList(7, "/timeline") }).verdict).toBe("pending");
  });

  it("the floor constant is the issue's 0.8 and baseline is 7", () => {
    expect(COVERAGE_FLOOR).toBe(0.8);
    expect(INITIAL_COVERED).toBe(7);
  });
});

describe("canary-timeline-coverage — CLI exit codes", () => {
  it("alarms (exit 3, regression) when coverage drops below the seeded baseline", () => {
    // The BASELINE_SITEMAP fixture has 1 covered of 2 ads — below baseline.
    const result = spawnSync(process.execPath, [script, "--input", writeFixture(BASELINE_SITEMAP)], {
      encoding: "utf8",
    });
    expect(result.status).toBe(3);
    expect(result.stdout).toContain("verdict: REGRESSION");
  });

  it("observes (exit 1, pending) when the baseline holds but the floor is unreached", () => {
    const xml =
      pathList(91, "/ads").map((p) => `<url><loc>${p}</loc></url>`).join("") +
      pathList(7, "/timeline").map((p) => `<url><loc>${p}</loc></url>`).join("");
    const result = spawnSync(process.execPath, [script, "--input", writeFixture(xml)], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("verdict: pending");
  });

  it("passes on an at-floor sitemap", () => {
    const xml =
      pathList(10, "/ads").map((p) => `<url><loc>${p}</loc></url>`).join("") +
      pathList(9, "/timeline").map((p) => `<url><loc>${p}</loc></url>`).join("");
    const result = spawnSync(process.execPath, [script, "--input", writeFixture(xml)], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  it("unreadable fixture exits 2 (probe failure, not a coverage verdict)", () => {
    const result = spawnSync(
      process.execPath,
      [script, "--input", join(tmpdir(), `missing-${Date.now()}.xml`)],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
  });

  // Fixture-poisoning guard (M56 pattern): pure fixture input must never
  // reach the issue-filing path, even with --file-issue.
  it("does not fire the filing path on fixture input", () => {
    const xml =
      `<url><loc>/static</loc></url>` +
      pathList(50, "/ads").map((p) => `<url><loc>${p}</loc></url>`).join("") +
      `<url><loc>/timeline/one.com</loc></url>`;
    const result = spawnSync(
      process.execPath,
      [script, "--input", writeFixture(xml), "--file-issue", "--dry-run"],
      { encoding: "utf8" },
    );
    expect(result.stdout).not.toContain("would run: gh issue create");
    expect(result.stdout).not.toContain("auto-filed");
    expect(result.status).toBe(3);
  });
});
