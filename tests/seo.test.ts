import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { publicSeoFileForPathname } from "~/lib/seo";

describe("public SEO files", () => {
  it("does not publish dynamic search in the public sitemap", () => {
    const sitemap = publicSeoFileForPathname("/sitemap.xml");

    expect(sitemap?.body).toContain("https://0509.io/");
    expect(sitemap?.body).toContain("https://0509.io/help");
    expect(sitemap?.body).toContain("https://0509.io/docs");
    expect(sitemap?.body).toContain("https://0509.io/api/docs");
    expect(sitemap?.body).toContain("https://0509.io/status");
    expect(sitemap?.body).toContain("https://0509.io/changelog");
    expect(sitemap?.body).toContain("https://0509.io/trust");
    expect(sitemap?.body).toContain("https://0509.io/privacy");
    expect(sitemap?.body).toContain("https://0509.io/terms");
    expect(sitemap?.body).not.toContain("https://0509.io/search");
  });

  it("keeps security.txt canonical and contact addresses on the io domain", () => {
    const rootSecurity = readFileSync("public/security.txt", "utf8");
    const wellKnownSecurity = readFileSync("public/.well-known/security.txt", "utf8");

    expect(wellKnownSecurity).toBe(rootSecurity);
    expect(rootSecurity).toContain("Contact: mailto:support@0509.io");
    expect(rootSecurity).toContain("Canonical: https://0509.io/.well-known/security.txt");
    expect(rootSecurity).not.toContain("0509.in");
  });

  it("keeps the cached social card customer-facing", () => {
    const card = publicSeoFileForPathname("/social-card.svg");

    expect(card?.body).toContain("Watch ads and landing pages with sources.");
    expect(card?.body).toContain("Saved evidence");
    expect(card?.body).not.toContain("with proof");
    expect(card?.body).not.toContain("Saved proof");
  });

  it("keeps skill.md entry points on the io domain", () => {
    const skill = readFileSync("public/.well-known/skill.md", "utf8");

    expect(skill).toContain("https://0509.io/");
    expect(skill).toContain("https://0509.io/api/docs");
    expect(skill).toContain("support@0509.io");
    expect(skill).not.toContain("0509.in");
    expect(skill).not.toContain("Slack-ready");
    expect(skill).not.toContain("Slack delivery");
    expect(skill).not.toContain("configured Slack target");
    expect(skill).toContain("Email is the verified automated delivery channel for launch.");
  });
});
