import { describe, expect, it } from "vitest";

import { lintTextAt, pathIsIgnored } from "./eslint-lint-text";

// #3944: `npm run e2e` starts `wrangler dev --local`, which writes generated
// bundles under `.wrangler/tmp/`. Those files are gitignored, but `eslint .`
// was not ignoring them, so the next `npm run lint` failed on no-unused-vars
// and parse errors inside the generated bundle. The lint script is `eslint .`
// with this repo's flat config, so the proof loads that config — a restated
// glob in the test would pass even if eslint.config.js dropped the entry.

// An unused binding plus a token sequence no JS parser accepts. Either is an
// error when the file is actually linted, and neither can be silent.
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
