// Resolve hook for tests/monitoring-brief-ranking.test.ts when it runs under
// the bare node test runner (`node --test tests/monitoring-brief-ranking.test.ts`,
// the verify command on issue #3016). Bare node has no tsconfig path mapping,
// so `~/lib/...` specifiers are rewritten here to real files under `app/`.
// Node's default loader then type-strips the .ts files natively (node >= 22.18).
// Under vitest this hook is never registered — vite resolves the alias itself.
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const APP_DIR = path.resolve(import.meta.dirname, "..", "app");

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("~/")) {
    const base = path.join(APP_DIR, specifier.slice(2));
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = base + suffix;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
