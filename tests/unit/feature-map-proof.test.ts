import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registeredToolDescriptors } from "../../app/lib/agent/mcp-tools";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAP = path.join(REPO_ROOT, ".agents", "skills", "verify", "feature-map.md");

const SPEC_REF = /e2e\/[A-Za-z0-9_./-]+\.spec\.ts/g;

const TOOL_CLAUSE = "tools, each with an output schema:";

async function e2eSpecFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await e2eSpecFiles(full)));
      continue;
    }
    if (!entry.name.endsWith(".spec.ts")) continue;
    found.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
  }
  return found;
}

describe("feature map proof coverage", () => {
  it("names every spec on disk", async () => {
    const map = await readFile(MAP, "utf8");
    const unnamed = (await e2eSpecFiles(path.join(REPO_ROOT, "e2e"))).filter((rel) => !map.includes(rel));
    expect(
      unnamed,
      unnamed.map((rel) => `name \`${rel}\` in the Proof column of the row whose behaviour it asserts`).join("\n"),
    ).toEqual([]);
  });

  it("names no spec that is not on disk", async () => {
    const map = await readFile(MAP, "utf8");
    const onDisk = new Set(await e2eSpecFiles(path.join(REPO_ROOT, "e2e")));
    const dead = [...new Set(map.match(SPEC_REF) ?? [])].filter((ref) => !onDisk.has(ref));
    expect(
      dead,
      dead
        .map((ref) => `\`${ref}\` is named in a Proof column but no such file exists — fix or remove the reference`)
        .join("\n"),
    ).toEqual([]);
  });

  it("has no duplicate route row", async () => {
    const map = await readFile(MAP, "utf8");
    const seen = new Map<string, number>();
    const duplicates: string[] = [];
    map.split("\n").forEach((line, index) => {
      if (!line.startsWith("|")) return;
      const cells = line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
      if (cells.length < 2 || !cells[0].startsWith("`")) return;
      const key = `${cells[0]}\t${cells[1]}`;
      const first = seen.get(key);
      if (first !== undefined) {
        duplicates.push(`lines ${first} and ${index + 1} both claim ${cells[0]} in ${cells[1]}`);
        return;
      }
      seen.set(key, index + 1);
    });

    expect(seen.size, "the parser must have read rows from the map").toBeGreaterThan(0);
    expect(
      [...seen.keys()].some((key) => key.startsWith("`/`\t")),
      "the `/` route must be in the map",
    ).toBe(true);
    expect(duplicates, duplicates.join("\n")).toEqual([]);
  });

  it("names every registered MCP tool in the `/mcp` row", async () => {
    const map = await readFile(MAP, "utf8");
    const row = map.split("\n").find((line) => line.startsWith("| `/mcp`"));
    expect(row, "the map has no `/mcp` row").toBeDefined();
    const names: string[] = Object.keys(registeredToolDescriptors);

    expect(names.length, "registeredToolDescriptors must not be empty").toBeGreaterThan(0);
    const missing = names.filter((name) => !row?.includes(`\`${name}\``));
    expect(missing, missing.map((name) => `name \`${name}\` in the /mcp row`).join("\n")).toEqual([]);

    const clause = row?.split(TOOL_CLAUSE)[1]?.split("(")[0] ?? "";
    const named = [...clause.matchAll(/`([a-z][a-z_]+)`/g)].map((match) => match[1]);
    expect(named.length, `the /mcp row must name its tools after \`${TOOL_CLAUSE}\``).toBeGreaterThan(0);
    const dead = named.filter((word) => !names.includes(word));
    expect(
      dead,
      dead.map((word) => `\`${word}\` is named in the /mcp row but is not a registered tool`).join("\n"),
    ).toEqual([]);
  });
});
