import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROJECT_SERVICE_MISS = "was not found by the project service";

function underTypedTree(rel: string): boolean {
  return rel.startsWith("app/") || rel.startsWith("workers/") || rel.startsWith("e2e/") || rel.startsWith("tests/");
}

export async function lintTextAt(rel: string, code: string): Promise<{ ignored: boolean; messages: string[] }> {
  const filePath = path.join(REPO_ROOT, rel);
  const eslint = new ESLint({ cwd: REPO_ROOT });
  if (await eslint.isPathIgnored(filePath)) {
    return { ignored: true, messages: [] };
  }
  if (underTypedTree(rel)) {
    await access(filePath);
  }
  const results = await eslint.lintText(code, { filePath, warnIgnored: true });
  const messages = results.flatMap((result) => result.messages.map((message) => message.message));
  if (messages.some((message) => message.includes(PROJECT_SERVICE_MISS))) {
    throw new Error(`${rel} ${PROJECT_SERVICE_MISS}`);
  }
  return { ignored: false, messages };
}

export async function lintExisting(rel: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
  return results.flatMap((result) => result.messages.map((message) => message.message));
}

export async function pathIsIgnored(rel: string): Promise<boolean> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  return eslint.isPathIgnored(path.join(REPO_ROOT, rel));
}
