import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ENTRY_DOCS = ["AGENTS.md", "README.md"] as const;
const PATH = /`((?:app|docs|workers|tests|e2e|migrations|\.agents)\/[\w./-]+[\w-])`/g;

const RETIRED = [
  /\bhash-checked\b/,
  /\bFable\b/,
  /\bOpus deputy\b/,
  /Two orchestrator sessions/,
  /#3842/,
  /about \d+ KB/,
  /- \*\*Immutability\.\*\*/,
] as const;

const LIVE = [
  /Stock only, at the version named in `docs\/dependencies\.md`/,
  /Jev decides every typed decision/,
  /Browser Rendering capped at 10/,
  /Guardrails/,
  /Nothing from the pre-wipe code is reused/,
  /new objects,\s+never mutation/,
  /site is gated until the audit passes/,
] as const;

const HIDDEN_CREDENTIAL_DIRS = ["~/.config/cloudflare", "~/.cloudflare", "~/.wrangler"] as const;

function homePathsIn(text: string): string[] {
  return [...text.matchAll(/(?:~|\$\{?HOME\}?)\/[^\s`"'<>),;]+/g)].map((match) =>
    (match[0] ?? "").replace(/^\$\{?HOME\}?/, "~"),
  );
}

describe("agent entry docs", () => {
  it.each(ENTRY_DOCS)("%s names only paths that exist", (doc) => {
    const text = readFileSync(new URL(`../${doc}`, import.meta.url), "utf8");
    const missing = [...text.matchAll(PATH)]
      .map((match) => match[1] ?? "")
      .filter((path) => !existsSync(new URL(`../${path}`, import.meta.url)));
    expect(missing).toEqual([]);
  });

  it("AGENTS.md keeps no claim about a mechanism that does not exist", () => {
    const text = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
    const found = RETIRED.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
    expect(found).toEqual([]);
  });

  it("AGENTS.md keeps the live rules the retired section carried", () => {
    const text = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
    const missing = LIVE.filter((pattern) => !pattern.test(text)).map((pattern) => pattern.source);
    expect(missing).toEqual([]);
  });

  it.each(ENTRY_DOCS)("%s names no file inside a credential directory the runner hides", (doc) => {
    const text = readFileSync(new URL(`../${doc}`, import.meta.url), "utf8");
    const unreachable = homePathsIn(text).filter((path) =>
      HIDDEN_CREDENTIAL_DIRS.some((dir) => path.replace(/\/+$/, "").startsWith(`${dir}/`)),
    );
    expect(unreachable).toEqual([]);
  });
});

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = `${join(REPO_ROOT, "migrations")}/`;

const SKIP_DIRS = [
  ".git",
  "node_modules",
  "docs",
  "public",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  ".wrangler",
] as const;
const SKIP_EXTENSIONS = [".png", ".jpg", ".webp", ".ico", ".woff2"] as const;
let scanCache: string[] | undefined;

function scanSet(): string[] {
  if (scanCache) return scanCache;
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter((name) => name !== "");
  scanCache = tracked
    .filter((name) => !SKIP_DIRS.some((skip) => name.split("/").includes(skip)))
    .filter((name) => !SKIP_EXTENSIONS.some((extension) => name.endsWith(extension)))
    .map((name) => join(REPO_ROOT, name))
    .filter((path) => existsSync(path));
  return scanCache;
}

const DOCS_SECTION = /\n## Docs/;

function readSource(path: string): string {
  const text = readFileSync(path, "utf8");
  return path === join(REPO_ROOT, "AGENTS.md") ? (text.split(DOCS_SECTION)[0] ?? text) : text;
}

function historyDocs(): { file: string; token: string }[] {
  const enginesDir = join(REPO_ROOT, "docs/engines");
  const engines = (existsSync(enginesDir) ? readdirSync(enginesDir) : [])
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => ({ file: join(enginesDir, name), token: `engines/${name}` }));
  const rebuilds = readdirSync(join(REPO_ROOT, "docs"))
    .filter((name) => name.startsWith("REBUILD-") && name.endsWith(".md"))
    .map((name) => ({ file: join(REPO_ROOT, "docs", name), token: name }));
  return [...engines, ...rebuilds];
}

describe("design history docs", () => {
  it.each(historyDocs().map((doc) => [doc.token, doc.file] as const))(
    "%s is cited outside migrations/",
    (token, file) => {
      const cited = scanSet()
        .filter((path) => !path.startsWith(MIGRATIONS))
        .filter((path) => readSource(path).includes(token));
      expect(cited.length).toBeGreaterThan(0);
      expect(existsSync(file)).toBe(true);
    },
  );

  it("is cited by a file that exists", () => {
    const citation = /(?:docs\/)?(engines\/[\w-]+|REBUILD-[\w-]+)\.md/g;
    const dangling: string[] = [];
    for (const path of scanSet().filter((candidate) => !candidate.startsWith(MIGRATIONS))) {
      for (const match of readFileSync(path, "utf8").matchAll(citation)) {
        const target = join(REPO_ROOT, "docs", `${match[1]}.md`);
        if (!existsSync(target)) dangling.push(`${path.slice(REPO_ROOT.length)}: ${match[0]}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});
