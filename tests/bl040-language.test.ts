import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const layout = readFileSync("app/routes/app-layout.tsx", "utf8");
const sourceAccess = readFileSync(
  "app/routes/app.source-access.ui.tsx",
  "utf8",
);
const developerAccess = readFileSync(
  "app/routes/app.developer-access.ui.tsx",
  "utf8",
);
const css = readFileSync("app/app.css", "utf8");
const cssHeading =
  "/* === BL-040 source + developer access (landing language) === */";
const bl040Css = css.slice(css.indexOf(cssHeading));

describe("BL-040 landing-language surfaces", () => {
  it("suppresses the old shell topbar on both rebuilt routes", () => {
    expect(layout).toContain('pathname === "/app/source-access"');
    expect(layout).toContain('pathname === "/app/developer-access"');
  });

  it("uses the working header and page layer without old panel theatre", () => {
    for (const route of [sourceAccess, developerAccess]) {
      expect(route).toContain("<WorkingHeader");
      expect(route).toContain('className="f9-wk-page f9-bl040-page');
      expect(route).not.toContain("DashboardPageHeader");
      expect(route).not.toContain("f9-app-panel");
      expect(route).not.toContain("f9-status-strip");
      expect(route).not.toContain("f9-source-guide");
    }
  });

  it("keeps the source setup state as a red sentence-case word", () => {
    expect(sourceAccess).toContain(
      'return { label: "Needs setup", tone: "bad" }',
    );
    expect(sourceAccess).toContain("f9-bl040-status");
    expect(sourceAccess).not.toContain("f9-ed-stamp");
  });

  it("keeps API-key secrets and danger actions as ruled text controls", () => {
    expect(developerAccess).toContain("f9-bl040-key-rows");
    expect(developerAccess).toContain('"Reveal"');
    expect(developerAccess).toContain('"Copy"');
    expect(developerAccess).toContain('confirmLabel="Confirm — revoke key?"');
    expect(developerAccess).not.toContain("f9-secondary-button");
  });

  it("owns the final CSS section and spends only 1px square rules", () => {
    expect(css.match(new RegExp(cssHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    expect(css.trimEnd().endsWith(bl040Css.trimEnd())).toBe(true);
    expect(bl040Css).not.toMatch(/border(?:-[a-z]+)?(?:-width)?:\s*[2-9]px/u);
    expect(
      [...bl040Css.matchAll(/border-radius:\s*([^;\n]+)/gu)].map((match) =>
        match[1].trim(),
      ),
    ).toEqual(["0", "0", "0"]);
    expect(
      [...bl040Css.matchAll(/box-shadow:\s*([^;\n]+)/gu)].map((match) =>
        match[1].trim(),
      ),
    ).toEqual(["none"]);
  });
});
