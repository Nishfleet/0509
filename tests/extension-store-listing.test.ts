import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const listing = readFileSync(
  new URL("../extension/store/listing.md", import.meta.url),
  "utf8",
);
const readme = readFileSync(new URL("../extension/README.md", import.meta.url), "utf8");
const manifest = JSON.parse(
  readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"),
) as { name: string; description: string };

const BRAND_SHOT = new URL(
  "../extension/store/screenshot-popup-on-brand.png",
  import.meta.url,
);
const FALLBACK_SHOT = new URL(
  "../extension/store/screenshot-popup-fallback.png",
  import.meta.url,
);

function pngSize(buf: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(0, 8).equals(signature)).toBe(true);
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("Chrome Web Store listing bundle", () => {
  it("keeps paste-ready name, short description, category, and activeTab justification", () => {
    expect(listing).toContain(manifest.name);
    expect(listing).toContain(manifest.description);
    expect(manifest.name.length).toBeLessThanOrEqual(75);
    expect(manifest.description.length).toBeLessThanOrEqual(132);
    expect(listing).toContain("**Category:** Productivity");
    expect(listing).toContain("**Language:** English");
    expect(listing).toMatch(/activeTab reads the active tab's URL after the user opens the extension/);
    expect(listing).toContain("No `tabs` permission, no host permissions, no content scripts.");
    expect(listing).toContain("https://0509.io/privacy");
    expect(listing).not.toContain("Sends nothing anywhere");
  });

  it("ships two 1280×800 load-unpacked screenshots", () => {
    const brand = pngSize(readFileSync(BRAND_SHOT));
    const fallback = pngSize(readFileSync(FALLBACK_SHOT));
    expect(brand).toEqual({ width: 1280, height: 800 });
    expect(fallback).toEqual({ width: 1280, height: 800 });
    expect(listing).toContain("screenshot-popup-on-brand.png");
    expect(listing).toContain("screenshot-popup-fallback.png");
  });

  it("leaves only the owner account, $5 fee, and submit as remaining steps", () => {
    expect(readme).toContain("store/listing.md");
    expect(readme).toContain("- [x] **Listing assets:**");
    expect(readme).toContain("- [x] **Listing copy**");
    expect(readme).toContain("- [x] **Privacy tab answers**");
    expect(readme).toContain("- [x] **Category and language:** Productivity");
    expect(readme).toContain("Remaining owner steps (money");
    expect(readme).toContain("- [ ] Register the Chrome Web Store developer account.");
    expect(readme).toContain("- [ ] Pay the one-time $5 developer fee.");
    expect(readme).toContain("- [ ] Submit:");
    expect(readme).toContain("Do not create the account, pay, or submit from an agent session.");
  });
});
