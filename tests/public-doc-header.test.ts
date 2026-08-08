import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync("app/app.css", "utf8");

describe("public document header", () => {
  it("keeps the legal header brand, subtitle, and focus ring readable on the bone nav", () => {
    expect(css).toContain(`.f9-legal-page .f9-brandmark .f9-wordmark {
  color: var(--ld-ink, #0e0d0a);`);
    expect(css).toContain(`.f9-legal-page .f9-brandmark small {
  color: var(--ld-ink, #0e0d0a);`);
    expect(css).toContain(`.f9-legal-page .f9-brandmark:focus-visible {
  outline-color: var(--ld-ink, #0e0d0a);`);
    expect(css).toContain(`.f9-legal-page .f9-legal-nav,
.f9-error-page .f9-error-layout {
  background: var(--ld-bone);`);
    expect(css).toContain(
      `.f9-legal-page .f9-search-nav-links a { color: var(--ld-ink-soft); }`,
    );
    expect(css).toContain(`.f9-legal-page .f9-search-nav-links a:hover,
.f9-legal-page .f9-search-nav-links a:focus-visible { color: var(--ld-ink); }`);
    expect(css).not.toContain(`.f9-legal-page .f9-brandmark .f9-wordmark {
  color: var(--ld-bone, #f4f1e8);`);
    expect(css).not.toContain(`.f9-legal-page .f9-brandmark small {
  color: var(--ld-bone, #f4f1e8);`);
    expect(css).not.toContain(`.f9-legal-page .f9-brandmark:focus-visible {
  outline-color: var(--ld-bone, #f4f1e8);`);
  });

  it("keeps the app-brand override stronger than the later shared legal wordmark rule", () => {
    const appBrandRule = css.indexOf(".f9-legal-page .f9-brandmark .f9-wordmark {");
    const sharedRule = css.indexOf(".f9-legal-page .f9-wordmark,\n");

    expect(appBrandRule).toBeGreaterThanOrEqual(0);
    expect(sharedRule).toBeGreaterThan(appBrandRule);
    expect(css.slice(appBrandRule, sharedRule)).toContain("color: var(--ld-ink, #0e0d0a);");
  });
});
