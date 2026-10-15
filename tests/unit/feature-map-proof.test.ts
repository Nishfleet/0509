import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registeredToolDescriptors } from "../../app/lib/agent/mcp-tools";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAP_DIR = path.join(REPO_ROOT, ".agents", "skills", "verify", "feature-map");
const MAP_INDEX = path.join(REPO_ROOT, ".agents", "skills", "verify", "feature-map.md");
const SPEC_REF = /e2e\/[A-Za-z0-9_./-]+\.spec\.ts/g;
const HAS_SPEC = /e2e\/[A-Za-z0-9_./-]+\.spec\.ts/;
const NO_BROWSER = "No browser spec:";
const TOOL_CLAUSE = "tools, each with an output schema:";

interface MapFile {
  name: string;
  text: string;
}

async function mapFiles(): Promise<MapFile[]> {
  const entries = await readdir(MAP_DIR, { recursive: true, withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const full = path.join(entry.parentPath, entry.name);
        return { name: path.relative(MAP_DIR, full).split(path.sep).join("/"), text: await readFile(full, "utf8") };
      }),
  );
}

async function allMapFiles(): Promise<MapFile[]> {
  return [{ name: "feature-map.md", text: await readFile(MAP_INDEX, "utf8") }, ...(await mapFiles())];
}

async function readMap(): Promise<string> {
  return (await allMapFiles()).map((file) => file.text).join("\n");
}

function routeRows(text: string): string[][] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length >= 2 && !/^(Route|Surface|:?-+:?)$/.test(cells[0]));
}

async function e2eSpecFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
    .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

describe("feature map proof coverage", () => {
  it("names every spec on disk", async () => {
    const map = await readMap();
    const unnamed = (await e2eSpecFiles(path.join(REPO_ROOT, "e2e"))).filter((rel) => !map.includes(rel));
    expect(
      unnamed,
      unnamed.map((rel) => `name \`${rel}\` in the Proof column of the row whose behaviour it asserts`).join("\n"),
    ).toEqual([]);
  });

  it("names no spec that is not on disk", async () => {
    const map = await readMap();
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
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of await allMapFiles()) {
      for (const cells of routeRows(file.text)) {
        const key = `${cells[0]}\t${cells[1]}`;
        const first = seen.get(key);
        if (first !== undefined) {
          duplicates.push(`${first} and ${file.name} both claim ${cells[0]} in ${cells[1]}`);
          continue;
        }
        seen.set(key, file.name);
      }
    }
    expect(seen.size, "the parser must have read rows from the map").toBeGreaterThan(0);
    expect(
      [...seen.keys()].some((key) => key.startsWith("`/`\t")),
      "the `/` route must be in the map",
    ).toBe(true);
    expect(duplicates, duplicates.join("\n")).toEqual([]);
  });

  it("holds exactly one row in each file", async () => {
    const files = await mapFiles();
    expect(files.length, "the map must have row files").toBeGreaterThan(0);
    const wrong = files
      .map((file) => ({ name: file.name, rows: file.text.split("\n").filter((line) => line.startsWith("|")).length }))
      .filter((file) => file.rows !== 3)
      .map((file) => `${file.name} has ${file.rows} table lines; a file is a header, a separator and one row`);
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("gives every row a browser spec, or says in its Proof cell why it has none", async () => {
    const rows = routeRows(await readMap()).filter((cells) => cells.length >= 5);
    expect(rows.length, "the parser must have read rows from the map").toBeGreaterThan(0);
    const bare = rows
      .filter((cells) => !HAS_SPEC.test(cells.at(-1) ?? "") && !(cells.at(-1) ?? "").includes(NO_BROWSER))
      .map((cells) => `${cells[0]} names no e2e spec: name one in its Proof cell, or write "${NO_BROWSER} <why>"`);
    expect(bare, bare.join("\n")).toEqual([]);
  });

  it("holds a row for every route in app/routes.ts", async () => {
    const registry = await readFile(path.join(REPO_ROOT, "app", "routes.ts"), "utf8");
    const registered = [...registry.matchAll(/route\("([^"]*)"/g)].map((match) => match[1]);
    expect(registered.length, "the parser must have read routes").toBeGreaterThan(0);
    const claimed = new Set<string>();
    let catchAll = false;
    for (const cells of routeRows(await readMap())) {
      for (const match of cells[0].matchAll(/`(\/[^`]*)`/g)) claimed.add(match[1]);
      if (cells[0].includes("any other path")) catchAll = true;
    }
    const missing = registered
      .filter((route) => (route === "*" ? !catchAll : !claimed.has(`/${route.replace(/\?$/, "")}`)))
      .map((route) => `app/routes.ts registers \`${route}\` but no feature-map row names it`);
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("names every registered MCP tool in the `/mcp` row", async () => {
    const map = await readMap();
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
