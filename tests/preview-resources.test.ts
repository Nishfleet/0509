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
    expect(previews).not.toContain(PROD_D1);
    expect(previews).not.toContain(PROD_BUCKET);
    expect(previews).not.toContain("BETTER_AUTH_URL");
    expect(previews).not.toContain("send-email");
  });

  it("holds preview routing on while e2e runs and fails closed without credentials", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const job = ci.slice(ci.indexOf("name: preview-assert"));
    expect(job).toContain("missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
    expect(job).toContain('select(.type=="preview") | .deployment_urls[0]');
    const e2e = job.slice(job.indexOf("Run the e2e suite against the preview deployment"));
    expect(e2e).toContain('"previews_enabled":true');
    expect(e2e).toContain("npm run e2e");
    expect(e2e.indexOf('"previews_enabled":true')).toBeLessThan(e2e.indexOf("npm run e2e"));
  });
});
