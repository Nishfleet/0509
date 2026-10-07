import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// A path named in the agent entry docs that does not exist sends the next agent
// grepping for it. Only the two files every agent reads first are checked.
const ENTRY_DOCS = ["AGENTS.md", "README.md"] as const;
const PATH = /`((?:app|docs|workers|tests|e2e|migrations|\.agents)\/[\w./-]+[\w-])`/g;

// 0509#7006: CLAUDE.md's "Rebuild rules" section claimed a hash-check mechanism
// that exists nowhere in the repo, described retired orchestration roles, sent
// lane posts to a closed issue, and gave a stale feature-map size. 0509#7005 then
// made AGENTS.md the canonical doc and reduced CLAUDE.md to its `@AGENTS.md`
// import, so this gate reads AGENTS.md, the file that now carries the rules.
// This is a wording gate, not a mechanism check: it catches the return of those
// exact claims. It fails on the old text and passes once the claims are gone. The
// live rules the section carried stay, so the deletion cannot take them with it.
const RETIRED = [
  /\bhash-checked\b/,
  /\bFable\b/,
  /\bOpus deputy\b/,
  /Two orchestrator sessions/,
  /#3842/,
  /about \d+ KB/,
] as const;

// The four live rules move from "Rebuild rules" into "Conventions", the
// gated-site rule moves to "Rules that are not about code", and the pre-wipe
// reuse rule stays as policy. None of them may leave the file with the section.
const LIVE = [
  /Stock only, at the version named in `docs\/dependencies\.md`/,
  /Jev decides every typed decision/,
  /Browser Rendering capped at 10/,
  /Guardrails/,
  /Nothing from the pre-wipe code is reused/,
  /site is gated until the audit passes/,
] as const;

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
});

// 0509#7018 (R7): `docs/engines/*.md` and `docs/REBUILD-*.md` are design
// history. A citation of one that was deleted sends the next agent `grep -r`
// for a file that is only in git history, so the two tests below gate both
// directions: every kept doc is cited somewhere (otherwise it is orphaned, and
// the lock has nothing to lock), and every citation outside `docs/` and
// `migrations/` resolves (otherwise a dangling one survives the deletions).
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
// The whole repo root, walked recursively, minus the directories that cannot
// carry a citation. A named allowlist (app/, workers/, tests/, e2e/,
// migrations/, .github/, .agents/ plus five root files) left CLAUDE.md, every
// other root config and any future top-level directory outside the gate, so a
// dangling citation in one of them passed; the in-run review of #7275 found it.
const SKIP_DIRS = [".git", "node_modules", "docs", "public"] as const;
const SKIP_EXTENSIONS = [".png", ".jpg", ".webp", ".ico", ".woff2"] as const;

function scanSet(): string[] {
  const scanned: string[] = [];
  for (const entry of readdirSync(REPO_ROOT, { recursive: true })) {
    const path = join(REPO_ROOT, String(entry));
    try {
      if (!statSync(path).isFile()) continue;
    } catch {
      continue;
    }
    const relative = path.slice(REPO_ROOT.length);
    if (SKIP_DIRS.some((dir) => relative.startsWith(`${dir}/`))) continue;
    if (SKIP_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;
    scanned.push(path);
  }
  return scanned;
}

// `AGENTS.md` records what was deleted and where to read it instead, so its
// `## Docs` section is a citation of design history by intent, not a claim that
// a live file exists. Test B reads it whole; Test A stops at that heading.
const DOCS_SECTION = /\n## Docs/;

function readSource(path: string): string {
  const text = readFileSync(path, "utf8");
  return path === join(REPO_ROOT, "AGENTS.md") ? (text.split(DOCS_SECTION)[0] ?? text) : text;
}

function historyDocs(): { file: string; token: string }[] {
  const engines = readdirSync(join(REPO_ROOT, "docs/engines"))
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => ({ file: join(REPO_ROOT, "docs/engines", name), token: `engines/${name}` }));
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
        .filter((path) => !path.startsWith(join(REPO_ROOT, "migrations")))
        .filter((path) => readSource(path).includes(token));
      expect(cited.length).toBeGreaterThan(0);
      expect(existsSync(file)).toBe(true);
    },
  );

  it("is cited by a file that exists", () => {
    const citation = /(?:docs\/)?(engines\/[\w-]+|REBUILD-[\w-]+)\.md/g;
    const dangling: string[] = [];
    for (const path of scanSet().filter((candidate) => !candidate.startsWith(join(REPO_ROOT, "migrations")))) {
      for (const match of readFileSync(path, "utf8").matchAll(citation)) {
        const target = join(REPO_ROOT, "docs", `${match[1]}.md`);
        if (!existsSync(target)) dangling.push(`${path.slice(REPO_ROOT.length)}: ${match[0]}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});
