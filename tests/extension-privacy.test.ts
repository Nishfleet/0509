import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const readme = readFileSync(new URL("../extension/README.md", import.meta.url), "utf8");
const normalizedReadme = readme.replace(/\s+/g, " ");

describe("extension privacy contract", () => {
  it("keeps the extension limited to the just-in-time activeTab permission", () => {
    expect(manifest.permissions).toEqual(["activeTab"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("background");
  });

  it("keeps the Store disclosure aligned with extension behavior", () => {
    expect(normalizedReadme).toContain("The current URL is handled locally");
    expect(normalizedReadme).toContain("the domain is sent to Five to Nine");
    expect(normalizedReadme).toContain("declare **Web browsing activity**");
    expect(normalizedReadme).toContain("The extension does not persist the URL or domain");
    expect(normalizedReadme).toContain("service providers needed to operate the chosen action");
    expect(normalizedReadme).toContain("Limited Use requirements");
    expect(normalizedReadme).toContain("https://0509.io/privacy");
    expect(readme).not.toContain("Sends nothing anywhere");
    expect(readme).not.toContain("The extension itself collects nothing");
    expect(readme).not.toContain('declare "no user data collected"');
  });
});
