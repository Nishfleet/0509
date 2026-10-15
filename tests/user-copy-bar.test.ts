import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { BANNED_PHRASES, EXEMPT_PATHS, TITLE_CASE_LABEL_EXCEPTIONS } from "./user-copy-phrases.js";

const ROOTS = ["app/routes", "app/components", "app/lib", "workers/delivery", "workers/standing"];
const BUTTON_TAGS = new Set(["button", "Button", "a", "Link", "NavLink"]);

function sourceFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function stringsIn(file: string, code = readFileSync(file, "utf8")): { text: string; label: boolean }[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: { text: string; label: boolean }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      found.push({ text: node.text, label: false });
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      found.push({ text: node.text, label: false });
    if (ts.isJsxText(node) && node.text.trim()) {
      const parent = node.parent;
      const tag = ts.isJsxElement(parent) ? parent.openingElement.tagName.getText() : "";
      found.push({ text: node.text.replace(/\s+/g, " ").trim(), label: BUTTON_TAGS.has(tag) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function isTitleCase(text: string): boolean {
  const cleaned = TITLE_CASE_LABEL_EXCEPTIONS.reduce((rest, name) => rest.replaceAll(name, ""), text).trim();
  const words = cleaned.split(/\s+/).filter((word) => /^[A-Za-z]/.test(word));
  return words.length >= 2 && words.every((word) => /^[A-Z]/.test(word));
}

describe("the copy bar", () => {
  const files = ROOTS.flatMap(sourceFiles).filter((file) => !EXEMPT_PATHS.some(({ path }) => file.startsWith(path)));

  it("has none of the banned phrases in what people read", () => {
    const hits = files.flatMap((file) =>
      stringsIn(file).flatMap(({ text }) =>
        BANNED_PHRASES.filter(({ pattern }) => pattern.test(text)).map(
          ({ pattern, instead }) => `${file}: ${pattern} in "${text.slice(0, 80)}" (${instead})`,
        ),
      ),
    );
    expect(hits).toEqual([]);
  });

  it("has no Title Case button labels", () => {
    const hits = files.flatMap((file) =>
      stringsIn(file)
        .filter(({ label, text }) => label && isTitleCase(text))
        .map(({ text }) => `${file}: "${text}"`),
    );
    expect(hits).toEqual([]);
  });

  it("catches what it is meant to catch", () => {
    const sample = 'const a = "Oops, it broke!"; const b = <Button>Save Changes</Button>; const c = <p>Click here</p>;';
    const strings = stringsIn("sample.tsx", sample);
    const banned = strings.filter(({ text }) => BANNED_PHRASES.some(({ pattern }) => pattern.test(text)));
    expect(banned.map(({ text }) => text)).toEqual(["Oops, it broke!", "Click here"]);
    expect(strings.filter(({ label, text }) => label && isTitleCase(text)).map(({ text }) => text)).toEqual([
      "Save Changes",
    ]);
    expect(isTitleCase("Back to home")).toBe(false);
    expect(isTitleCase("Open in Five to Nine")).toBe(false);
  });
});
