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

const DISPOSE_CALLED = `import { env, introspectWorkflowInstance } from "cloudflare:test";
import { it } from "vitest";

it("cleans up", async () => {
  const instance = await introspectWorkflowInstance(env.SITE_SWEEP, "id");
  try {
    await instance.waitForStatus("complete");
  } finally {
    await instance.dispose();
  }
});
`;

const DISPOSE_IN_OTHER_TEST = `import { env, introspectWorkflow } from "cloudflare:test";
import { describe, it } from "vitest";

describe("sweep", () => {
  it("leaks", async () => {
    const introspector = await introspectWorkflow(env.ACCOUNT_DELETE);
    await introspector.get();
  });

  it("cleans up", async () => {
    const other = await introspectWorkflow(env.ACCOUNT_DELETE);
    await other.dispose();
  });
});
`;

const DISPOSE_IN_LOOP = `import { env, introspectWorkflowInstance } from "cloudflare:test";
import { it } from "vitest";

it("cleans up each", async () => {
  for (const id of ["a", "b"]) {
    const introspector = await introspectWorkflowInstance(env.SITE_SWEEP, id);
    await introspector.waitForStatus("complete");
    await introspector.dispose();
  }
});
`;

const DISPOSE_IN_NESTED_FUNCTION = `import { env, introspectWorkflow } from "cloudflare:test";
import { it, onTestFinished } from "vitest";

it("cleans up later", async () => {
  if (env.ACCOUNT_DELETE) {
    const introspector = await introspectWorkflow(env.ACCOUNT_DELETE);
    onTestFinished(async () => {
      await introspector.dispose();
    });
    await introspector.get();
  }
});
`;

const DISPOSE_ON_OTHER_BINDING = `import { env, introspectWorkflow } from "cloudflare:test";
import { it } from "vitest";

it("leaks", async () => {
  const introspector = await introspectWorkflow(env.ACCOUNT_DELETE);
  const other = await introspectWorkflow(env.ACCOUNT_DELETE);
  await introspector.get();
  await other.dispose();
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

  it("allows an explicit dispose() call", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(AT, DISPOSE_CALLED);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(false);
  });

  it("allows a dispose() call inside a loop", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(AT, DISPOSE_IN_LOOP);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(false);
  });

  it("allows a dispose() call in a nested function", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(AT, DISPOSE_IN_NESTED_FUNCTION);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(false);
  });

  it("rejects a dispose() call on a different variable", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(AT, DISPOSE_ON_OTHER_BINDING);
    expect(result.messages.filter((m) => m.includes(MESSAGE))).toHaveLength(1);
  });

  it("rejects a test whose dispose() sits in another test", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(AT, DISPOSE_IN_OTHER_TEST);
    expect(result.messages.filter((m) => m.includes(MESSAGE))).toHaveLength(1);
  });

  it("keeps every current introspector disposed", { timeout: 60_000 }, async () => {
    const messages = await lintExisting(AT);
    expect(messages.some((m) => m.includes(MESSAGE))).toBe(false);
  });
});
