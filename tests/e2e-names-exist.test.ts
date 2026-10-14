import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// 0509#7430: main renamed the cancelled-plan button to "Manage billing" and
// the billing-state spec still looked for "Manage or cancel plan"; only the
// preview run caught it, 10 minutes later. A name an e2e spec looks up by a
// string literal must still exist as a phrase in app source, public files,
// workers, or as seed data elsewhere in e2e. Names the app builds at run time
// from a template are listed below with the template that builds them.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BUILT_AT_RUN_TIME: Record<string, string> = {
  "Starter watches up to 15 competitors.": "plan sentence built from the Starter limit",
  "No data": "chart empty state built per series",
  "https://0509.io/mcp": "production URL of the MCP endpoint",
  "expires in 5 minutes": "email body built from the link lifetime",
  "Medium mentions": "tab label built from the mention weight",
  "There is no page at /this-page-is-not-here.": "404 sentence built from the requested path",
};

const LOCATOR =
  /(?:getByRole\(\s*"[a-z]+"\s*,\s*\{\s*name:|getByLabel\(|getByPlaceholder\(|getByText\(|\bbutton:)\s*"([^"]+)"/g;

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(path.join(REPO_ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((file) => extensions.some((extension) => file.endsWith(extension)))
    .map((file) => path.join(REPO_ROOT, dir, file));
}

function read(files: readonly string[]): string {
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

function countless(name: string): string {
  return name.replace(/\s+\d+$/, "");
}

describe("e2e names still exist", () => {
  const appText = read(
    ["app", "public", "workers"].flatMap((dir) => filesUnder(dir, [".ts", ".tsx", ".html", ".css", ".md"])),
  );
  const specs = filesUnder("e2e", [".ts"]).map((file) => ({ file, text: readFileSync(file, "utf8") }));
  const seedText = specs.map((spec) => spec.text.replace(LOCATOR, "")).join("\n");

  it("every literal name an e2e locator looks up is still in the app", () => {
    const stale = specs.flatMap(({ file, text }) =>
      [...text.matchAll(LOCATOR)]
        .map((match) => match[1] ?? "")
        .map((name) => ({ file: path.relative(REPO_ROOT, file), name, bare: countless(name) }))
        .filter(({ bare }) => !appText.includes(bare) && !seedText.includes(bare) && !(bare in BUILT_AT_RUN_TIME))
        .map(({ file: relative, name }) => `${relative}: ${name}`),
    );
    expect(stale).toEqual([]);
  });

  it("lists no run-time name that an e2e spec no longer uses", () => {
    const used = new Set(specs.flatMap(({ text }) => [...text.matchAll(LOCATOR)].map((match) => match[1] ?? "")));
    expect(Object.keys(BUILT_AT_RUN_TIME).filter((name) => !used.has(name))).toEqual([]);
  });
});
