import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOTS = ["app/components", "app/routes", "app/lib", "workers/delivery"];
const PROMPTS = new Set(["app/lib/discovery/run.server.ts"]);

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/;

const NAMES: readonly { wrong: RegExp; use: string }[] = [
  { wrong: /\brivals?\b/i, use: "competitor" },
  { wrong: /\bweekly reports?\b/i, use: "brief" },
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !entry.endsWith(".d.ts") ? [path] : [];
  });
}

function visibleText(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    const isText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node);
    if (isText && /\s/.test(node.text.trim()) && !SQL.test(node.text)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("customer-facing copy names each thing once", () => {
  const files = ROOTS.flatMap(sources).filter((file) => !PROMPTS.has(file));
  for (const { wrong, use } of NAMES) {
    it(`never says ${String(wrong)}; the word is "${use}"`, () => {
      const hits = files.flatMap((file) =>
        visibleText(file)
          .filter((text) => wrong.test(text))
          .map((text) => `${file}: ${text.trim().slice(0, 90)}`),
      );
      expect(hits).toEqual([]);
    });
  }
});
