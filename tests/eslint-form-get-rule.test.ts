import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #7027 / #7033: 16 of 17 action modules read form fields with formData.get
// instead of a zod parse. #7111: the gate was selector-based on the receiver
// NAME (form or formData), so a receiver called anything else read fields by
// hand with the gate green. It is now form-rules/form-data-get in
// eslint.config.js, which reads the receiver's TypeScript type. Identifier
// form.get / formData.get is the action-input shape; navigation.formData?.get
// (pending UI) is FormData | undefined and stays allowed. These probes boot the
// real eslint.config.js (same rig as tests/eslint-catch-null-rule.test.ts).

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FORM_GET_MESSAGE = "formData.get by hand";

const HAND_GET = `export function readField(formData: FormData): unknown {
  return formData.get("email");
}
`;

const FORM_GET = `export function readField(form: FormData): unknown {
  return form.get("intent");
}
`;

const ZOD_PARSE = `import { z } from "zod";
export function readField(formData: FormData): unknown {
  return z.object({ email: z.string() }).safeParse(Object.fromEntries(formData));
}
`;

const PENDING_UI = `export function pendingIntent(navigation: { formData?: FormData }): boolean {
  return navigation.formData?.get("intent") === "allow";
}
`;

const OTHER_NAME = `export function readField(fd: FormData): unknown {
  return fd.get("intent");
}
`;

const OTHER_LOCAL = `export async function readField(request: Request): Promise<unknown> {
  const body = await request.formData();
  return body.get("intent");
}
`;

const COMPUTED_GET = `export function readField(form: FormData): unknown {
  return form["get"]("intent");
}
`;

const MAP_GET = `export function readField(): string | undefined {
  const attrs = new Map<string, string>();
  return attrs.get("intent");
}
`;

const HEADERS_GET = `export function readField(): string | null {
  return new Headers().get("content-type");
}
`;

async function lintProbe(rel: string, code: string): Promise<{ ignored: boolean; messages: string[] }> {
  const file = path.join(REPO_ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    if (await eslint.isPathIgnored(file)) {
      return { ignored: true, messages: [] };
    }
    const results = await eslint.lintFiles([file]);
    return {
      ignored: false,
      messages: results.flatMap((result) => result.messages.map((m) => m.message)),
    };
  } finally {
    await rm(file, { force: true });
  }
}

async function lintExisting(rel: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
  return results.flatMap((result) => result.messages.map((m) => m.message));
}

describe("eslint formData.get rule (#7027)", () => {
  it("rejects formData.get in an action route", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-form-get-tmp.ts", HAND_GET);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FORM_GET_MESSAGE))).toBe(true);
  });

  it("rejects form.get in a server action module", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/probe-form-get-tmp.server.ts", FORM_GET);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FORM_GET_MESSAGE))).toBe(true);
  });

  it("allows a zod parse of Object.fromEntries(formData) in a route", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-form-get-tmp.ts", ZOD_PARSE);
    expect(result.messages.some((m) => m.includes(FORM_GET_MESSAGE))).toBe(false);
  });

  it("leaves navigation.formData.get for pending UI unblocked", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-form-get-tmp.ts", PENDING_UI);
    expect(result.messages.some((m) => m.includes(FORM_GET_MESSAGE))).toBe(false);
  });

  it("leaves isDraftSave on card-fields.ts unblocked", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/lib/identity/card-fields.ts");
    expect(messages.some((m) => m.includes(FORM_GET_MESSAGE))).toBe(false);
  });

  it("rejects a FormData receiver under any other name", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-form-get-tmp.ts", OTHER_NAME);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FORM_GET_MESSAGE))).toBe(true);
  });

  it("rejects a FormData local under any other name", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-form-get-tmp.ts", OTHER_LOCAL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FORM_GET_MESSAGE))).toBe(true);
  });

  it("rejects a computed form[\"get\"] read", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-form-get-tmp.ts", COMPUTED_GET);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FORM_GET_MESSAGE))).toBe(true);
  });

  it("leaves a Map.get unblocked", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-form-get-tmp.ts", MAP_GET);
    expect(result.messages.some((m) => m.includes(FORM_GET_MESSAGE))).toBe(false);
  });

  it("leaves a Headers.get unblocked", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-form-get-tmp.ts", HEADERS_GET);
    expect(result.messages.some((m) => m.includes(FORM_GET_MESSAGE))).toBe(false);
  });
});
