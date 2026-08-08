import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync("app/app.css", "utf8");

describe("public accessibility source contract", () => {
  it("uses dark focus treatments on light marketing, share, and mobile app surfaces", () => {
    expect(css).toContain(`.f9-home :is(a, button, input):focus-visible {
  outline: 3px solid var(--ld-green-ink);`);
    expect(css).toContain(`.f9-share-header .f9-app-brand:focus-visible {
  outline-color: var(--f9-search-ink);`);
    expect(css).toContain(`.f9-dash-page-app .f9-dash-mobile-nav :is(a, button):focus-visible {
    outline: 2px solid var(--wk-focus);`);
  });

  it("disables smooth scrolling when reduced motion is requested", () => {
    expect(css).toContain(`@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;`);
  });

  it("keeps auth brand and authenticated navigation touch targets at least 44px tall", () => {
    expect(css).toContain(`.f9-auth-page .f9-auth-brand {
  min-height: 44px;`);
    expect(css).toContain(`.f9-cursor-rail nav a {
  display: flex;
  align-items: center;
  min-height: 44px;`);
    expect(css).toContain(`.f9-dash-page-app .f9-cursor-rail nav a {
    min-height: 44px;`);
    expect(css).toContain(`@media (min-width: 761px) and (max-width: 900px) {
  .f9-find-page .f9-cursor-rail nav a {
    min-height: 44px;`);
  });

  it("keeps the auth story headline inside its box when the display font falls back", () => {
    expect(css).toContain(`.f9-auth-story h1 {
  max-width: min(100%, 32rem);`);
    expect(css).not.toContain("max-width: 10.6ch;");
  });
});
