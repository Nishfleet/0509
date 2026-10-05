import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SHARED = ["logo/"];

describe("R2 write prefixes", () => {
  it("delete lists every workspace-scoped put prefix, and names logo as shared (0509#7080)", async () => {
    const putters = [
      "app/lib/site/check-page.server.ts",
      "app/lib/site/sweep.server.ts",
      "app/lib/hiring/read-board.server.ts",
      "app/lib/feeds/read-feed.server.ts",
      "app/lib/identity/logo-store.server.ts",
    ];
    const written = new Set<string>();
    for (const rel of putters) {
      const source = await readFile(path.join(REPO_ROOT, rel), "utf8");
      for (const match of source.matchAll(/`([a-z]+\/)/g)) written.add(match[1]);
    }
    const deleter = await readFile(path.join(REPO_ROOT, "app/lib/data/workspace.server.ts"), "utf8");
    const deleted = [...deleter.matchAll(/`([a-z]+\/)/g)].map((match) => match[1]);
    expect(written.has("logo/")).toBe(true);
    expect(deleted).toEqual(expect.arrayContaining(["card/", "snapshot/"]));
    expect(deleted).not.toContain("logo/");
    for (const prefix of written) {
      if (SHARED.includes(prefix)) continue;
      expect(deleted, `${prefix} is written and missing from readWorkspaceR2Prefixes`).toContain(prefix);
    }
  });
});
