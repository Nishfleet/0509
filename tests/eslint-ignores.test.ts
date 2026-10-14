import { describe, expect, it } from "vitest";

import { lintTextAt, pathIsIgnored } from "./eslint-lint-text";

const GENERATED = "const unused = 1;\nexport default function (((\n";

describe("eslint ignores wrangler build output (#3944)", () => {
  it("ignores the .wrangler/tmp bundle wrangler dev writes", { timeout: 60_000 }, async () => {
    expect(await pathIsIgnored(".wrangler/tmp/bundle-abc/middleware-insertion-facade.js")).toBe(true);
  });

  it("ignores the rest of the .wrangler tree, matching .gitignore", { timeout: 60_000 }, async () => {
    expect(await pathIsIgnored(".wrangler/state/generated.ts")).toBe(true);
  });

  it("still lints a file outside the ignored trees", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("tests/eslint-ignores.test.ts", GENERATED);
    expect(result.ignored).toBe(false);
    expect(result.messages.length).toBeGreaterThan(0);
  });
});
