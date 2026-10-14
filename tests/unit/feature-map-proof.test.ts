import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registeredToolDescriptors } from "../../app/lib/agent/mcp-tools";

// #6133: drift in the feature map was found and never fixed — six open issues
// said the same thing. The class fix is this gate: a spec that no Proof row
// names, or a Proof row that names a spec not on disk, fails the PR. The shape
// is the e2e-fixture-cleanup.test.ts one by copy: REPO_ROOT from
// import.meta.url, a recursive readdir, a pure-regex probe. The map is
// hand-written on purpose; this test reads it, it does not generate it.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAP_DIR = path.join(REPO_ROOT, ".agents", "skills", "verify", "feature-map");
const MAP_INDEX = path.join(REPO_ROOT, ".agents", "skills", "verify", "feature-map.md");
// The same pattern the gardener sweeps used, so this gate fails on exactly
// the references a human sweep would report.
const SPEC_REF = /e2e\/[A-Za-z0-9_./-]+\.spec\.ts/g;
// The `/mcp` row lists its tools inside one clause. The split phrase is named
// here so a reword of that clause fails with the phrase, not a bare count.
const TOOL_CLAUSE = "tools, each with an output schema:";

interface MapFile {
  name: string;
  text: string;
}

async function mapFiles(dir: string = MAP_DIR): Promise<MapFile[]> {
  const found: MapFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await mapFiles(full)));
      continue;
    }
    found.push({
      name: path.relative(MAP_DIR, full).split(path.sep).join("/"),
      text: await readFile(full, "utf8"),
    });
  }
  return found;
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
    .filter((cells) => cells.length >= 2 && cells[0].startsWith("`"));
}

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

  // #7016: a merge-conflict resolution (ab00c365f) left two `/login` rows
  // (lines 27 and 28), each claiming `app/routes/login.tsx`, and only the newer
  // one carries the turnstile-blocked spec. Nothing failed, so the stale twin
  // stayed. The fix is this gate: every route row is unique on its Route + File
  // pair, so a second row for the same route and file fails the PR. Row shape
  // is taken from the file: a route row's first cell starts with a backtick,
  // while the header, the separator and the "Not a route" table do not (#6133
  // pattern). A parser that drifts and reads nothing would pass green while
  // checking nothing, so a positive control proves rows were actually seen.
  it("has no duplicate route row", async () => {
    const map = await readMap();
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
    // Positive control: a parse that reads nothing must not pass green. The
    // map's route tables carry far more than a handful of rows, and `/` is on
    // every one of them.
    expect(seen.size, "the parser must have read rows from the map").toBeGreaterThan(0);
    expect(
      [...seen.keys()].some((key) => key.startsWith("`/`\t")),
      "the `/` route must be in the map",
    ).toBe(true);
    expect(duplicates, duplicates.join("\n")).toEqual([]);
  });

  // The feature map is one row per file so parallel PRs edit different lines:
  // on 2026-10-14 one shared file knocked a PR out of the queue three times and
  // held a migration PR for three hours. A file with two rows would bring the
  // shared lines back, and a file with none documents nothing.
  it("holds exactly one row in each file", async () => {
    const files = await mapFiles();
    expect(files.length, "the map must have row files").toBeGreaterThan(0);
    const wrong = files
      .map((file) => ({ name: file.name, rows: file.text.split("\n").filter((line) => line.startsWith("|")).length }))
      .filter((file) => file.rows !== 3)
      .map((file) => `${file.name} has ${file.rows} table lines; a file is a header, a separator and one row`);
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  // 0509#7085 (item 7): the map's `/mcp` row named three tools
  // (`get_brief`, `list_competitors`, `list_alerts`) long after the server
  // registered five — the map is hand-written, so it drifts silently. The
  // tool list is machine-checkable against `registeredToolDescriptors`, so
  // this gate names every registered tool and forbids naming a dead one.
  it("names every registered MCP tool in the `/mcp` row", async () => {
    const map = await readMap();
    const row = map.split("\n").find((line) => line.startsWith("| `/mcp`"));
    expect(row, "the map has no `/mcp` row").toBeDefined();
    const names: string[] = Object.keys(registeredToolDescriptors);
    // Positive control: the registry must not be empty, or the gate is vacuous.
    expect(names.length, "registeredToolDescriptors must not be empty").toBeGreaterThan(0);
    const missing = names.filter((name) => !row?.includes(`\`${name}\``));
    expect(missing, missing.map((name) => `name \`${name}\` in the /mcp row`).join("\n")).toEqual([]);
    // The tool list is the clause "read-only tools, each with an output schema:
    // …" up to the first parenthesis; other backticked tokens in the row are
    // not tools, so only this clause is checked for dead names. The split phrase
    // is named in the failure so a reword says what moved.
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
