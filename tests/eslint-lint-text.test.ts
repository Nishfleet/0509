import path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, lintTextAt, pathIsIgnored } from "./eslint-lint-text";

const MISSING = "app/lib/probe-linttext-missing.server.ts";
const FETCH = `export async function probe(): Promise<Response> {
  return fetch("https://example.com/logo.png");
}
`;

describe("eslint lintText helper (#7026)", () => {
  it("project service refuses a path that is not on disk", { timeout: 60_000 }, async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const results = await eslint.lintText(FETCH, {
      filePath: path.join(REPO_ROOT, MISSING),
      warnIgnored: true,
    });
    expect(
      results[0]?.messages.some((message) => message.message.includes("was not found by the project service")),
    ).toBe(true);
  });

  it("lintTextAt on a real app/lib file flags a bare fetch", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("app/lib/cadence.ts", FETCH);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((message) => message.includes("Outbound fetch is owned by app/lib/fetch/"))).toBe(true);
  });

  it("lintTextAt throws instead of treating a missing app path as clean", { timeout: 60_000 }, async () => {
    await expect(lintTextAt(MISSING, FETCH)).rejects.toThrow(/no such file|ENOENT|not found by the project service/i);
  });

  it("pathIsIgnored sees .wrangler without writing a file", { timeout: 60_000 }, async () => {
    expect(await pathIsIgnored(".wrangler/tmp/bundle-abc/middleware-insertion-facade.js")).toBe(true);
  });

  it("flags a writeFile disk probe in an eslint rule test", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(
      "tests/eslint-fetch-rule.test.ts",
      `import { writeFile } from "node:fs/promises";\nawait writeFile("x", "y");\n`,
    );
    expect(result.messages.some((message) => message.includes("lint in memory with lintText"))).toBe(true);
  });

  it("flags an empty cloudflare:workers env mock", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(
      "tests/session-gate.test.ts",
      `import { vi } from "vitest";\nvi.mock("cloudflare:workers", () => ({ env: {} }));\n`,
    );
    expect(result.messages.some((message) => message.includes("empty vi.mock({ env: {} })"))).toBe(true);
  });

  it.each([
    ["arrow body", `vi.mock("cloudflare:workers", () => ({ env: {} }));`],
    ["block body", `vi.mock("cloudflare:workers", () => {\n  return { env: {} };\n});`],
    ["async block body", `vi.mock("cloudflare:workers", async () => {\n  return { env: {} };\n});`],
    ["doMock", `vi.doMock("cloudflare:workers", () => ({ env: {} }));`],
  ])("flags an empty cloudflare:workers env mock with %s", { timeout: 60_000 }, async (_name, mock) => {
    const result = await lintTextAt("tests/session-gate.test.ts", `import { vi } from "vitest";\n${mock}\n`);
    expect(result.messages.some((message) => message.includes("empty vi.mock({ env: {} })"))).toBe(true);
  });

  it("leaves a cloudflare:workers mock with real bindings alone", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(
      "tests/session-gate.test.ts",
      `import { vi } from "vitest";\nvi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));\n`,
    );
    expect(result.messages.some((message) => message.includes("empty vi.mock({ env: {} })"))).toBe(false);
  });
});
