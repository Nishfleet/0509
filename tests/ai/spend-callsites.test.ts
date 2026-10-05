import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_SPEND_VAR } from "../../app/lib/ai/spend.server";

const ROOTS = ["app", "workers"];

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return extname(entry.name) === ".ts" ? [path] : [];
  });

const aiCallSites = ROOTS.flatMap(sources).filter((path) => /\.AI\.run\(/.test(readFileSync(path, "utf8")));

describe("the ai spend kill switch (0509#7191)", () => {
  it("has both call sites to guard: the jev judge and the discovery proposer", () => {
    expect(aiCallSites).toEqual(["app/lib/discovery/generators/ai.server.ts", "app/lib/jev/client.server.ts"]);
  });

  it(`refuses to spend at every call site, so ${AI_SPEND_VAR}=off stops the scheduled and request paths alike`, () => {
    for (const path of aiCallSites) {
      expect(readFileSync(path, "utf8"), `${path} must check the kill switch before calling the model`).toContain(
        "refuseWhenAiSpendOff()",
      );
    }
  });
});