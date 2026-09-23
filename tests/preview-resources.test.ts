import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const PROD_D1 = "746c6e3d-782e-443a-82d6-28ca93a16294";
const PROD_BUCKET = "0509-snapshots";
const PREVIEW_D1 = "d6643a38-0666-470e-8e08-1953918dfd8a";

function previewsSection(source: string) {
  const at = source.indexOf('"previews"');
  if (at < 0) throw new Error("previews block missing");
  return source.slice(at);
}

describe("preview resource config", () => {
  it("binds preview D1 to 0509-preview and names no production storage", () => {
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    const migrations = readFileSync("wrangler.preview-migrations.jsonc", "utf8");
    const previews = previewsSection(wrangler);
    const id = migrations.match(/"database_id": "([^"]+)"/)?.[1];
    expect(migrations).toContain('"database_name": "0509-preview"');
    expect(id).toBe(PREVIEW_D1);
    expect(previews).toContain(`"database_id": "${id}"`);
    expect(previews).toContain('"database_name": "0509-preview"');
    expect(wrangler.slice(0, wrangler.indexOf('"previews"'))).toContain(PROD_BUCKET);
    expect(previews).not.toContain(PROD_D1);
    expect(previews).not.toContain(PROD_BUCKET);
    expect(previews).not.toContain("BETTER_AUTH_URL");
    expect(previews).toContain('"queue": "send-email-preview"');
    expect(previews).not.toContain('"queue": "send-email"');
    expect(wrangler).toContain('"BETTER_AUTH_URL": "https://0509.io"');
  });
});
