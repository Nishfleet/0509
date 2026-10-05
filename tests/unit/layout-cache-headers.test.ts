import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/lib/require-onboarded.server", () => ({ requireOnboarded: () => Promise.resolve() }));

import { headers as appLayoutHeaders } from "../../app/routes/app-layout";
import { headers as appSettingsLayoutHeaders } from "../../app/routes/app-settings-layout";

// The onboarding and per-route files carry server import graphs that would
// need a mock web, and their gate is textual: the export must exist (or must
// NOT exist) with the right cache-control. The layouts are imported for real,
// so the value itself is asserted, not just its source text.
const routeSource = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../app/routes/${name}`, import.meta.url)), "utf8");

const HEADERS_EXPORT = /export (?:async )?function headers\s*\(|export const headers\s*[:=]/;

describe("signed-in document pages send private, no-store by default (0509#7021)", () => {
  it("declares the default cache-control once per signed-in layout", () => {
    expect(appLayoutHeaders()).toEqual({ "cache-control": "private, no-store" });
    expect(appSettingsLayoutHeaders()).toEqual({ "cache-control": "private, no-store" });
  });

  it("keeps layout-covered leaves free of per-route copies that can drift", () => {
    for (const name of ["app.competitor.tsx", "settings.agents.tsx"]) {
      expect(routeSource(name), name).not.toMatch(HEADERS_EXPORT);
    }
  });

  it("covers the top-level onboarding pages no layout reaches", () => {
    for (const name of ["onboarding.tsx", "onboarding.competitors.tsx", "onboarding.identity.tsx"]) {
      const source = routeSource(name);
      expect(source, name).toMatch(HEADERS_EXPORT);
      expect(source, name).toContain('"cache-control": "private, no-store"');
    }
    // onboarding.identity must keep surfacing the loader's Server-Timing next
    // to the new cache-control, not replace it.
    expect(routeSource("onboarding.identity.tsx")).toMatch(/headers\(\{ loaderHeaders \}/);
  });
});
