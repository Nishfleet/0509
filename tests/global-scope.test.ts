import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #3969 (preview-assert): `npm run e2e` starts `wrangler dev --local`, and every
// module the server bundle imports is evaluated on boot. A `Response` (or a
// `Request`, or a `Headers`) constructed in a module's top-level scope is I/O
// there, and workerd answers with
//
//   Uncaught Error: Disallowed operation called within global scope.
//   Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and
//   generating random values are not allowed within global scope.
//
// at line 1 of the Worker — which is not the line the mistake is on. The
// `NOT_FOUND` constant in app/lib/card/serve.server.ts was hoisted to module
// scope, and every route 500'd until it became a function called per request.
//
// `preview-assert` catches this by building and serving the Worker, which is
// the real proof and stays. This test is the fast local half: it reads the app
// source and fails on the same shape long before a build, so the CI wait is not
// the only thing standing between the mistake and main.

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app");

// Only the constructors workerd refuses outside a handler. A top-level `const`
// holding one of these is the bug; a top-level string, SQL, or a regexp is not.
const DISALLOWED = ["Response", "Request", "Headers", "URL"];

// Strips comments and template strings so a doc comment mentioning the class
// name (which this file does) cannot fail itself. A regexp is a blunt
// instrument on JS but the alternative is a parse, and every false negative
// here costs one CI run while a false positive costs a wrong failure.
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""');
}

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await tsFiles(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

// A top-level `new X(...)` only counts when the statement opens at column 1
// with no indentation, which is what a module-scope const does. One nested at
// any depth — inside a function, a class method, an arrow body — is a handler
// and is fine.
function topLevelNews(source: string): string[] {
  const stripped = stripCommentsAndStrings(source);
  const hits: string[] = [];
  for (const name of DISALLOWED) {
    const pattern = new RegExp(`^(?:export\\s+)?(?:const|let|var|default)\\s+[A-Za-z_$][\\w$]*\\s*(?::[^=]*)?=\\s*new\\s+${name}\\s*\\(`, "gm");
    const direct = stripped.match(pattern);
    if (direct) hits.push(`${name}: ${direct[0].trim()}`);
    // `const A = new X(...)` written as a bare statement (no declaration
    // keyword) is rare and still module scope.
    const bare = stripped.match(new RegExp(`^new\\s+${name}\\s*\\(`, "gm"));
    if (bare) hits.push(`${name}: ${bare[0].trim()}`);
  }
  return hits;
}

describe("no workerd-disallowed construction at module scope (#3969)", () => {
  it("app/ never constructs a Response, Request, Headers or URL at top level", async () => {
    const files = await tsFiles(APP_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const hit of topLevelNews(source)) {
        offenders.push(`${path.relative(APP_ROOT, file)}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the shape it was written to catch is genuinely rejected", () => {
    // The detector is only worth shipping if it fires on the exact source that
    // broke preview-assert. Verified here against the hoisted constant that was
    // replaced, so a future weakening of the pattern fails this test rather
    // than silently passing the module that 500s every route.
    const hoisted = `import { env } from "cloudflare:workers";\nconst NOT_FOUND = new Response("Not found", { status: 404 });\n`;
    expect(topLevelNews(hoisted)).not.toEqual([]);
    const inside = `import { env } from "cloudflare:workers";\nfunction notFound() { return new Response("Not found", { status: 404 }); }\n`;
    expect(topLevelNews(inside)).toEqual([]);
  });
});
