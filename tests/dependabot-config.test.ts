import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// 0509#7074: a Dependabot run that defers because an npm-minor-patch
// group PR is open puts @cloudflare/workers-oauth-provider and
// @sentry/cloudflare into "Adding dependencies as handled" and then
// reports "Found no dependencies to update after filtering allowed
// updates" (runs 36721784366 and 36727409669). Majors therefore need
// their own group, and the schedule needs an explicit day, time and
// timezone so the run time is known. This gate fails until both land.
// It reads the file from disk; dependabot.yml has no import edge into
// the app, so it is checked by the full-suite run in the merge queue.
const CONFIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".github", "dependabot.yml");

// Dependabot schedule.time: HH:mm, 00:00 to 23:59.
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

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

const groupsContaining = (update: Update | undefined, ...types: string[]) =>
  Object.values(update?.groups ?? {}).filter((group) => types.every((type) => group["update-types"]?.includes(type)));

const scheduled = (update: Update | undefined) => update?.schedule;

describe(".github/dependabot.yml npm updates", () => {
  it("splits majors into their own group", () => {
    expect(npm).toBeDefined();
    const majors = groupsContaining(npm, "major");
    expect(majors).toHaveLength(1);
    expect(majors[0]["update-types"]).not.toContain("minor");
    expect(majors[0]["update-types"]).not.toContain("patch");
  });

  it("still groups minor and patch together", () => {
    expect(npm).toBeDefined();
    const minors = groupsContaining(npm, "minor", "patch");
    expect(minors).toHaveLength(1);
    expect(minors[0]["update-types"]).not.toContain("major");
  });

  it("ignores typescript and vitest majors", () => {
    const ignored = (npm?.ignore ?? []).map((entry) => entry["dependency-name"]);
    expect(ignored).toEqual(expect.arrayContaining(["typescript", "vitest"]));
  });

  it("runs every Monday at a known IST time", () => {
    expect(scheduled(npm)?.interval).toBe("weekly");
    expect(scheduled(npm)?.day).toBe("monday");
    expect(scheduled(npm)?.time).toMatch(TIME_OF_DAY);
    expect(scheduled(npm)?.timezone).toBe("Asia/Kolkata");
  });

  it("gives the github-actions watch the same known schedule", () => {
    expect(actions).toBeDefined();
    expect(scheduled(actions)?.interval).toBe("weekly");
    expect(scheduled(actions)?.day).toBe("monday");
    expect(scheduled(actions)?.time).toMatch(TIME_OF_DAY);
    expect(scheduled(actions)?.timezone).toBe("Asia/Kolkata");
  });

  it("does not claim a merge-queue live e2e gate (0509#7078)", () => {
    const source = readFileSync(CONFIG, "utf8");
    expect(source).not.toMatch(/behind the merge-queue live e2e/);
  });
});
