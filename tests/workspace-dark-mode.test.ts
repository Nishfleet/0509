import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync("app/app.css", "utf8");
const rootTsx = readFileSync("app/root.tsx", "utf8");
const searchRoute = readFileSync("app/routes/search.tsx", "utf8");
const searchResultRow = readFileSync(
  "app/components/search/result-row.tsx",
  "utf8",
);
const accountRoute = readFileSync("app/routes/app.account.tsx", "utf8");
const watchlistsRoute = readFileSync("app/routes/app.watchlists.tsx", "utf8");

describe("workspace dark mode (tokens + boot)", () => {
  it("defines the dark token sheet under the data attribute scope", () => {
    const darkBlock = css.match(/\[data-f9-theme="dark"\] \{[^}]+\}/)?.[0] ?? "";
    for (const declaration of [
      "--ink: #ece9e2",
      "--ink-soft: #b5b1a6",
      "--ink-faint: #8a867c",
      "--line: #33312c",
      "--card: #21201c",
      "--bone: #171611",
      "--green: #16c47f",
      "--green-ink: #7ee2b8",
      "--green-wash: #103326",
      "--red: #ff8577",
      "--red-wash: #2a1512",
      "--amber-wash: #2a2312",
      "color-scheme: dark",
    ]) {
      expect(darkBlock).toContain(declaration);
    }
  });

  it("keeps the light :root token sheet unchanged", () => {
    const lightBlock = css.slice(0, css.indexOf("}"));
    for (const declaration of [
      "--ink: #171611",
      "--ink-soft: #55524a",
      "--line: #e0ddd4",
      "--card: #fffdf8",
      "--bone: #f4f1e8",
      "--red: #b42318",
    ]) {
      expect(lightBlock).toContain(declaration);
    }
  });

  it("boots the theme before paint from root.tsx and follows theme-color", () => {
    expect(rootTsx).toContain("THEME_BOOT_SCRIPT");
    expect(rootTsx).toContain("htmlLangForPathname");
    expect(rootTsx).toContain("suppressHydrationWarning");
    expect(rootTsx).toContain("THEME_COLOR_LIGHT");
    expect(rootTsx).toContain("<ThemeSync />");
  });

  it("remaps the search shell's pinned light palette in dark mode", () => {
    expect(css).toContain('[data-f9-theme="dark"] .f9-find-page {');
    const remap = css.slice(css.indexOf('[data-f9-theme="dark"] .f9-find-page {'));
    expect(remap).toContain("--ld-bone: var(--bone)");
    expect(remap).toContain("--f9-search-ink: var(--ink)");
  });

  it("never scopes dark overrides to marketing or share containers", () => {
    expect(css).not.toMatch(/\[data-f9-theme="dark"\][^{,]*\.f9-home/);
    expect(css).not.toMatch(/\[data-f9-theme="dark"\][^{,]*\.ld-/);
    expect(css).not.toMatch(/\[data-f9-theme="dark"\][^{,]*\.f9-share-page/);
    expect(css).not.toMatch(/\[data-f9-theme="dark"\][^{,]*\.f9-auth-page/);
  });

  it("offers the three-way theme select on /app/account", () => {
    expect(accountRoute).toContain("ThemeToggle");
    expect(accountRoute).toContain("Workspace theme");
  });
});

describe("WP-42: optimistic watchlist pause/resume", () => {
  it("submits pause/resume through a fetcher, not a navigation Form", () => {
    expect(watchlistsRoute).toContain("useFetcher");
    expect(watchlistsRoute).toContain("<pauseResumeFetcher.Form method=\"post\">");
    const fetcherForm = watchlistsRoute.slice(
      watchlistsRoute.indexOf("<pauseResumeFetcher.Form"),
      watchlistsRoute.indexOf("</pauseResumeFetcher.Form>"),
    );
    expect(fetcherForm).toContain('"pause-watchlist" : "resume-watchlist"');
    // BL-006: the first fetcher form is the band's Rank-3 pause control, whose
    // pending state is the label itself ("Pausing…") rather than a spinner.
    expect(fetcherForm).toContain("Pausing…");
    expect(fetcherForm).toContain("Resuming…");
    // BL-007: the board band and the opened competitor now share ONE pause
    // control, so `aria-busy` is per watchlist instead of firing on every band
    // whenever any band is pausing. The label IS the pending state (Rank 3),
    // which is why the old toolbar spinner is gone.
    expect(fetcherForm).toContain("aria-busy={bandPending || undefined}");
  });
});

describe("WP-45: demo-sourced search results say so, per result", () => {
  it("labels demo-source ads Sample in the result row's own status column", () => {
    // BL-031: the guarantee is unchanged — a demo-sourced result is labelled
    // as a sample on the result itself, never only in a page-level banner.
    // What changed is how a state is drawn: it was a boxed <Pill>, and the v4
    // DNA states a state as a word in the row's status cell. The row also
    // withholds quick-save from a demo result, so nothing fabricated can be
    // saved into a workspace as evidence.
    expect(searchResultRow).toContain('const isDemo = ad.source === "demo"');
    expect(searchResultRow).toContain('status={isDemo ? "Sample" : formatAdActiveStatus(ad)}');
    expect(searchResultRow).toContain("canQuickSave && !isDemo");
  });
});

describe("WP-46: mobile hero keeps the sample-brief artifact", () => {
  it("keeps .ld-brief-strip visible and full-width at the 760px breakpoint", () => {
    const marker = css.indexOf("WP-46");
    expect(marker).toBeGreaterThan(-1);
    const block = css.slice(marker, marker + 400);
    expect(block).toContain("max-width: 760px");
    expect(block).toContain(".ld-brief-strip");
    expect(block).toContain("display: block");
    expect(block).toContain("max-width: 100%");
  });
});
