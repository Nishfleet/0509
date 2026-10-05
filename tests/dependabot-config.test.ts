import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// 0509#7074: a Dependabot group defers its own PR while one is open and marks
// the group's dependencies handled for the whole run, so the single
// `npm-minor-patch` group swallowed the @cloudflare/workers-oauth-provider and
// @sentry/cloudflare majors (runs 36721784366 and 36727409669): "Adding
// dependencies as handled: (...)" then "Found no dependencies to update after
// filtering allowed updates". Majors need their own group, and the weekly
// schedule needs a known day/time/timezone because the 2026-09-28 and 2026-10-05
// scans never ran. This gate fails until both land. It reads the file from
// disk; dependabot.yml has no import edge into the app, so it is checked the
// full-suite run in the merge queue.
const CONFIG = path.resolve(import.meta.dirname, "..", ".github", "dependabot.yml");

interface Group {
  "update-types"?: string[];
}

interface Schedule {
  interval?: string;
  day?: string;
  time?: string;
  timezone?: string;
}

interface Update {
  "package-ecosystem"?: string;
  schedule?: Schedule;
  groups?: Record<string, Group>;
  ignore?: { "dependency-name"?: string; "update-types"?: string[] }[];
}

const config = parse(readFileSync(CONFIG, "utf8")) as { updates: Update[] };
const npm = config.updates.find((u) => u["package-ecosystem"] === "npm");
const actions = config.updates.find((u) => u["package-ecosystem"] === "github-actions");

const groupHas = (update: Update | undefined, ...types: string[]) =>
  Object.values(update?.groups ?? {}).some((group) => types.every((type) => group["update-types"]?.includes(type)));

const scheduled = (update: Update | undefined) => update?.schedule;

describe(".github/dependabot.yml npm updates", () => {
  it("splits majors into their own group", () => {
    expect(groupHas(npm, "major")).toBe(true);
  });

  it("still groups minor and patch together", () => {
    expect(groupHas(npm, "minor", "patch")).toBe(true);
  });

  it("ignores typescript and vitest majors", () => {
    const ignored = (npm?.ignore ?? []).map((entry) => entry["dependency-name"]);
    expect(ignored).toEqual(expect.arrayContaining(["typescript", "vitest"]));
  });

  it("runs every Monday at a known IST time", () => {
    expect(scheduled(npm)?.interval).toBe("weekly");
    expect(scheduled(npm)?.day).toBe("monday");
    expect(scheduled(npm)?.time).toMatch(/^\d{2}:\d{2}$/);
    expect(scheduled(npm)?.timezone).toBe("Asia/Kolkata");
  });

  it("gives the github-actions watch the same known schedule", () => {
    expect(scheduled(actions)?.day).toBe("monday");
    expect(scheduled(actions)?.time).toMatch(/^\d{2}:\d{2}$/);
    expect(scheduled(actions)?.timezone).toBe("Asia/Kolkata");
  });
});
