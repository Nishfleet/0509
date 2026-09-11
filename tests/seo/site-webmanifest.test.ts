import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { links } from "~/root";

// Issue #2960 (2026-09-11): /site.webmanifest returned 404 while the site
// shipped icons/theme-colour — no manifest existed and <Links> never
// referenced one. This pins both halves: the manifest file exists, parses,
// its referenced icons exist in public/, and the root link list serves it.

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));

describe("site.webmanifest", () => {
  it("exists in public/ and parses as JSON", () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC_DIR, "site.webmanifest"), "utf8"));
    expect(manifest.name).toBe("0509");
    expect(manifest.theme_color).toBe("#f4f1e8");
    expect(manifest.background_color).toBe("#f4f1e8");
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it("references icon files that actually exist in public/", () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC_DIR, "site.webmanifest"), "utf8"));
    for (const icon of manifest.icons) {
      const file = join(PUBLIC_DIR, icon.src.replace(/^\//, ""));
      expect(readFileSync(file).byteLength).toBeGreaterThan(0);
    }
  });

  it("is linked from the root document", () => {
    expect(links()).toContainEqual({ rel: "manifest", href: "/site.webmanifest" });
  });
});
