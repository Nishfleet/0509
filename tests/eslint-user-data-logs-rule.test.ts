import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #5786 (privacy rule from #5776): logs and Sentry never carry customer data
// or prompt input. NO_USER_DATA_IN_LOGS is two-plus `no-restricted-syntax`
// selectors over `console.*` and `captureException`/`captureMessage`. These
// probes boot the real eslint.config.js (same rig as
// eslint-catch-null-rule.test.ts) and hold both directions: a value named like
// user data is flagged as a key, a value, a property read, a template
// interpolation, a nested call argument and a spread; the ids an operator
// needs, `workspaceId` and a capped error message, stay clean.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USER_DATA_MESSAGE = "never carry customer data or prompt input";

const PROBE = "app/lib/probe-user-data-logs-tmp.ts";

const HEADER = `declare const email: string;
declare const subject: { registrable: string };
declare const prompt: string;
declare const workspaceId: string;
declare const error: Error;
`;

async function lintProbe(code: string): Promise<string[]> {
  const file = path.join(REPO_ROOT, PROBE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${HEADER}${code}`);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const results = await eslint.lintFiles([file]);
    return results.flatMap((result) => result.messages.map((message) => message.message));
  } finally {
    await rm(file, { force: true });
  }
}

function flagged(messages: string[]): boolean {
  return messages.some((message) => message.includes(USER_DATA_MESSAGE));
}

describe("eslint no-user-data-in-logs rule (#5786)", () => {
  it("flags a user-data name as an object key", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log({ subject: subject.registrable });\n`))).toBe(true);
  });

  it("flags a user-data name as a shorthand value", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log({ email });\n`))).toBe(true);
  });

  it("flags a user-data property read", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log(user.email);\n`))).toBe(true);
  });

  it("flags a bare user-data argument", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log(email);\n`))).toBe(true);
  });

  it("flags a user-data name inside a template literal", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe("console.log(`user ${email}`);\n"))).toBe(true);
  });

  it("flags a user-data name wrapped in a call", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log(String(email));\n`))).toBe(true);
    expect(flagged(await lintProbe(`console.log(JSON.stringify(subject));\n`))).toBe(true);
  });

  it("flags a spread of a user-data value", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log({ ...subject });\n`))).toBe(true);
  });

  it("flags a user-data name sent to Sentry", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`import { captureException } from "@sentry/cloudflare";\ncaptureException(error, { extra: { prompt } });\n`))).toBe(true);
  });

  it("leaves the ids an operator needs and a capped error message alone", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(
      `console.log(JSON.stringify({ event: "probe", workspaceId, error: error.message.slice(0, 300) }));\n`,
    );
    expect(flagged(messages)).toBe(false);
  });

  it("leaves a non-user-data name alone", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log({ event: "probe", probe });\n`))).toBe(false);
  });
});
