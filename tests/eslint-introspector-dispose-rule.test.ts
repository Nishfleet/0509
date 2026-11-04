import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

const MESSAGE = "Hold a Workflow introspector with `await using";

const UNDISPOSED = `import { env, introspectWorkflow } from "cloudflare:test";
import { it } from "vitest";

it("leaks", async () => {
  const introspector = await introspectWorkflow(env.ACCOUNT_DELETE);
  await introspector.get();
});
`;

const UNDISPOSED_INSTANCE = `import { env, introspectWorkflowInstance } from "cloudflare:test";
import { it } from "vitest";

it("leaks", async () => {
  const introspector = await introspectWorkflowInstance(env.SITE_SWEEP, "id");
  await introspector.waitForStatus("complete");
});
`;

const DISPOSED = `import { env, introspectWorkflow } from "cloudflare:test";
import { it } from "vitest";

it("cleans up", async () => {
  await using introspector = await introspectWorkflow(env.ACCOUNT_DELETE);
  await introspector.get();
});
`;

const AT = "tests/integration/fixture-reaper.integration.test.ts";

describe("eslint Workflow introspector disposal (0509#7886)", () => {
  it("rejects an introspectWorkflow held by const", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(AT, UNDISPOSED);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(true);
  });

  it("rejects an introspectWorkflowInstance held by const", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(AT, UNDISPOSED_INSTANCE);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(true);
  });

  it("rejects it in tests/unit too", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("tests/unit/site/diff.test.ts", UNDISPOSED);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(true);
  });

  it("allows await using", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(AT, DISPOSED);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(false);
  });

  it("keeps every current introspector disposed", { timeout: 60_000 }, async () => {
    const messages = await lintExisting(AT);
    expect(messages.some((m) => m.includes(MESSAGE))).toBe(false);
  });
});
