import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const route = readFileSync("app/routes/app.notifications.ts", "utf8");
const ui = readFileSync("app/routes/app.notifications.ui.tsx", "utf8");
const css = readFileSync("app/app.css", "utf8");
const MARKER = "/* === BL-039 notifications (landing language) === */";
const FROZEN_ROUTE_SHA256 =
  "bf6943d14a1aaa2f32ed2048873e8addf7a1fa20543d72152c14bafa162194e3";

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("BL-039 notifications rebuild", () => {
  it("keeps the loader and action module byte-frozen", () => {
    expect(createHash("sha256").update(route).digest("hex")).toBe(
      FROZEN_ROUTE_SHA256,
    );
  });

  it("uses the shared working header and removes the old card dashboard", () => {
    expect(ui).toContain(
      '<DashboardPage className="f9-wk-page f9-nt-page">',
    );
    expect(ui).toContain("<WorkingHeader");
    expect(ui).toContain('title="Delivery channels"');
    expect(ui).not.toContain("DashboardPageHeader");
    expect(ui).not.toContain("f9-app-panel");
    expect(ui).not.toContain("f9-status-strip");
    expect(ui).not.toContain("f9-dashboard-grid");
  });

  it("appends exactly one owned CSS section at the end of app.css", () => {
    expect(css.match(/BL-039 notifications \(landing language\)/g)).toHaveLength(
      1,
    );
    const markerIndex = css.indexOf(MARKER);
    expect(markerIndex).toBeGreaterThan(-1);
    const layer = stripComments(css.slice(markerIndex));
    expect(layer.length).toBeGreaterThan(1_000);
    expect(markerIndex).toBeGreaterThan(css.indexOf("BL-030"));

    const widths = new Set<string>();
    for (const match of layer.matchAll(
      /border(?:-top|-right|-bottom|-left)?:\s*([^;]+);/g,
    )) {
      const value = match[1].trim();
      if (value === "0") continue;
      widths.add(value.split(/\s+/)[0]);
    }
    for (const match of layer.matchAll(
      /border-(?:top|right|bottom|left)-width:\s*([^;]+);/g,
    )) {
      widths.add(match[1].trim());
    }
    expect([...widths].sort()).toEqual(["1px"]);
  });

  it("keeps the owned layer square, flat, and token-based", () => {
    const markerIndex = css.indexOf(MARKER);
    expect(markerIndex).toBeGreaterThan(-1);
    const layer = stripComments(css.slice(markerIndex));
    const radii = [...layer.matchAll(/border-radius:\s*([^;]+);/g)].map(
      (match) => match[1].trim(),
    );
    expect(radii.length).toBeGreaterThan(0);
    expect(radii).toEqual(radii.map(() => "0"));
    expect(layer).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(layer).not.toMatch(/linear-gradient|radial-gradient/);
    expect(layer).not.toMatch(/box-shadow\s*:/);
    expect(layer).not.toMatch(/border-style:\s*dashed/);
  });
});
