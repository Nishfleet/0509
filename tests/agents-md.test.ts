import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #5740: a green test is not a finish line. The rule lives in AGENTS.md so
// every worker reads it. This file reads the real markdown; a restated copy
// here would stay green while the rule was deleted.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("AGENTS.md finish line", () => {
  it("requires a feature finish line to cite a real production record created after the merge", async () => {
    const text = await readFile(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    expect(text).toMatch(
      /finish line cites a real production record \(row id, Workflow instance id or run URL\) created after the merge/,
    );
  });
});
