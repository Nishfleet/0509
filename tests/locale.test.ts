import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { APP_LOCALE } from "../app/lib/locale";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function literalLocales(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      /^Intl\.(DateTimeFormat|NumberFormat|RelativeTimeFormat)$/.test(node.expression.getText()) &&
      node.arguments?.[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(`${file}: ${node.getText().slice(0, 60)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("one locale for dates, times and numbers", () => {
  it("every formatter takes APP_LOCALE, so a month is abbreviated one way everywhere", () => {
    const hits = ["app", "workers"].flatMap(sources).flatMap(literalLocales);
    expect(hits).toEqual([]);
  });

  it("abbreviates September one way for the whole app", () => {
    const format = (timeZone: string) =>
      new Intl.DateTimeFormat(APP_LOCALE, { day: "numeric", month: "short", timeZone }).format(
        new Date("2026-09-14T12:00:00Z"),
      );
    expect(format("UTC")).toBe(format("Europe/London"));
    expect(format("UTC")).toMatch(/^14 Sept?$/);
  });
});
