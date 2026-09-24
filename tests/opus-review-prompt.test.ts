import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #4627: the `opus-review` prompt in .github/workflows/ci.yml is the grader's
// whole contract — docs/REBUILD-TRUST.md §C1's three questions word for word,
// the grade-cap verdict rule, and the criteria that predate §C1. A restated
// copy here would stay green while the workflow drifted, so this file reads
// the real YAML and the real doc and fails if either drifts. No YAML parser
// exists in the stack (docs/REBUILD-STACK.md), so the block scalar is
// resolved by indentation, which is how the file itself is shaped.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

const readPrompt = (yaml: string): string => {
  const lines = yaml.split("\n");
  const start = lines.indexOf("  opus-review:");
  if (start === -1) {
    throw new Error("opus-review job not found in .github/workflows/ci.yml");
  }
  let p = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "prompt: |") {
      p = i;
      break;
    }
  }
  if (p === -1) {
    throw new Error("opus-review has no prompt: | block scalar");
  }
  const indent = lines[p].length - lines[p].trimStart().length;
  const collected: string[] = [];
  for (let i = p + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") {
      collected.push(line);
      continue;
    }
    const leading = line.length - line.trimStart().length;
    if (leading <= indent) {
      break;
    }
    collected.push(line);
  }
  return collected
    .map((line) => line.slice(indent + 2))
    .join("\n")
    .trim();
};

const readC1Questions = (md: string): string[] => {
  const start = md.indexOf("### C1.");
  if (start === -1) {
    throw new Error("§C1 section missing from docs/REBUILD-TRUST.md");
  }
  const rest = md.slice(start);
  const stops = [rest.indexOf("\n### "), rest.indexOf("\n## ")].filter((i) => i !== -1);
  const section = rest.slice(0, stops.length > 0 ? Math.min(...stops) : rest.length);
  // The doc runs the three questions as one paragraph, so a paragraph split
  // alone returns a single entry; each numbered line still starts one. A
  // question added to or dropped from the paragraph changes the count.
  const found: string[] = [];
  for (const paragraph of section.split(/\n\s*\n/)) {
    if (!/^[123]\. /.test(paragraph)) {
      continue;
    }
    let chunk = "";
    for (const line of paragraph.split("\n")) {
      if (/^[123]\. /.test(line) && chunk !== "") {
        found.push(chunk);
        chunk = line;
      } else {
        chunk += (chunk === "" ? "" : "\n") + line;
      }
    }
    if (chunk !== "") {
      found.push(chunk);
    }
  }
  return found.map(normalize);
};

describe("opus-review prompt", () => {
  it("is resolved as one block scalar by indentation", async () => {
    const prompt = readPrompt(
      await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8"),
    );
    expect(prompt.startsWith("REPO: ${{ github.repository }}")).toBe(true);
    expect(prompt.endsWith("Do not approve or request changes through the review API.")).toBe(true);
  });

  it("asks all three §C1 questions word for word", async () => {
    const prompt = readPrompt(
      await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8"),
    );
    const trust = await readFile(path.join(REPO_ROOT, "docs/REBUILD-TRUST.md"), "utf8");
    const qs = readC1Questions(trust);
    expect(qs).toHaveLength(3);
    for (const q of qs) {
      expect(normalize(prompt)).toContain(q);
    }
  });

  it("states the verdict rule in its grade-capping form", async () => {
    const prompt = readPrompt(
      await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8"),
    );
    expect(normalize(prompt)).toContain(
      'A "yes" to any of the three §C1 questions caps the grade at D unless the diff carries the lint rule that makes it impossible, or the body cites a filed 0509 issue for that rule.',
    );
  });

  it("keeps the criteria that predate §C1", async () => {
    const prompt = readPrompt(
      await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8"),
    );
    const normalized = normalize(prompt);
    for (const s of [
      "does the change do what the packet asked and nothing more",
      "is every claim in the body proven by something in the diff or a cited run",
      "tests assert behaviour, not implementation",
      "no scripts, hooks, wrappers, helpers or inline programs (the repo's no-glue rule)",
      "no comment that justifies a workaround",
      "the `encoded:` line names a real rung",
    ]) {
      expect(normalized).toContain(s);
    }
  });
});
