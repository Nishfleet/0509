import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #5786 (privacy rule from #5776): logs and Sentry never carry customer data
// or prompt input. NO_USER_DATA_IN_LOGS is a set of `no-restricted-syntax`
// selectors over `console.*` and the Sentry capture*/set* sinks, bare or on a
// namespace. These probes boot the real eslint.config.js (same rig as
// eslint-catch-null-rule.test.ts) and hold both directions: a value named like
// user data is flagged as a key, a value, a property read, a template
// interpolation, a nested call argument, a spread, a member read, a wrapped
// expression and each Sentry receiver form; the ids an operator needs,
// `workspaceId` and a capped error message, stay clean.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USER_DATA_MESSAGE = "never carry customer data or prompt input";

const PROBE = "app/lib/probe-user-data-logs-tmp.ts";

const HEADER = `declare const email: string;
declare const subject: { registrable: string };
declare const prompt: string;
declare const ip: string;
declare const userId: string;
declare const flag: boolean;
declare const input: { workspaceId: string };
declare const workspaceId: string;
declare const error: Error;
declare const controller: { cron: string };
declare function setTag(key: string, value: string): void;
declare function setExtra(key: string, value: string): void;
declare const Sentry: {
  setTag(key: string, value: string): void;
  setUser(value: { id: string }): void;
  captureEvent(value: { extra?: unknown }): void;
};
declare const scope: { setUser(value: { id: string }): void };
`;

async function lintProbe(code: string): Promise<string[]> {
  const file = path.join(REPO_ROOT, PROBE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${HEADER}${code}`);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    if (await eslint.isPathIgnored(file)) throw new Error(`${PROBE} is ignored; the rule would never run`);
    const results = await eslint.lintFiles([file]);
    return results.flatMap((result) => result.messages.map((message) => message.message));
  } finally {
    await rm(file, { force: true });
  }
}

async function lintExisting(rel: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
  return results.flatMap((result) => result.messages.map((message) => message.message));
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

  it("flags a user-data name inside a wrapped expression", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log("ip " + ip);\n`))).toBe(true);
    expect(flagged(await lintProbe(`console.log([email]);\n`))).toBe(true);
    expect(flagged(await lintProbe(`console.log(email ?? "");\n`))).toBe(true);
    expect(flagged(await lintProbe(`console.log(flag ? email : "x");\n`))).toBe(true);
  });

  it("flags a user-data name wrapped in a call", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log(String(email));\n`))).toBe(true);
    expect(flagged(await lintProbe(`console.log(JSON.stringify(subject));\n`))).toBe(true);
  });

  it("flags a member read off a user-data binding", { timeout: 60_000 }, async () => {
    // The shape this rule exists for: the log line dropped the `subject` key,
    // so a renamed key or a bare read is how the domain would get back in.
    expect(flagged(await lintProbe(`console.log(subject.registrable);\n`))).toBe(true);
    expect(flagged(await lintProbe(`console.log({ registrable: subject.registrable });\n`))).toBe(true);
    expect(flagged(await lintProbe(`console.log(email.trim());\n`))).toBe(true);
  });

  it("flags a spread of a user-data value", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log({ ...subject });\n`))).toBe(true);
  });

  it("flags a user-data name sent to Sentry", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`import { captureException } from "@sentry/cloudflare";\ncaptureException(error, { extra: { prompt } });\n`))).toBe(true);
  });

  it("flags a user-data name sent to a Sentry scope setter", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`setExtra("subject", subject.registrable);\n`))).toBe(true);
    expect(flagged(await lintProbe(`setTag("email", email);\n`))).toBe(true);
  });

  it("flags a user-data name sent to a namespaced Sentry sink", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`Sentry.setTag("email", email);\n`))).toBe(true);
    expect(flagged(await lintProbe(`Sentry.setUser({ id: userId });\n`))).toBe(true);
    expect(flagged(await lintProbe(`scope.setUser({ id: userId });\n`))).toBe(true);
    expect(flagged(await lintProbe(`Sentry.captureEvent({ extra: { prompt } });\n`))).toBe(true);
  });

  it("leaves the live scope setters in workers/app.ts alone", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`setTag("cron", controller.cron);\n`))).toBe(false);
    expect(flagged(await lintExisting("workers/app.ts"))).toBe(false);
  });

  it("leaves the ids an operator needs and a capped error message alone", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(
      `console.log(JSON.stringify({ event: "probe", workspaceId, error: error.message.slice(0, 300) }));\n`,
    );
    expect(flagged(messages)).toBe(false);
  });

  it("leaves the workspaceId read off a user-data-named binding alone", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log(JSON.stringify({ event: "probe", workspaceId: input.workspaceId }));\n`))).toBe(false);
    expect(flagged(await lintProbe(`console.log("ws " + input.workspaceId);\n`))).toBe(false);
  });

  it("leaves a non-user-data name alone", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`console.log({ event: "probe", probe });\n`))).toBe(false);
  });
});
