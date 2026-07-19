// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyTheme,
  isThemedPath,
  isThemePreference,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  THEME_BOOT_SCRIPT,
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  THEME_STORAGE_KEY,
} from "~/lib/theme-client";

function installMeta() {
  document.head.innerHTML = `<meta name="theme-color" content="${THEME_COLOR_LIGHT}">`;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-f9-theme");
  installMeta();
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-f9-theme");
});

describe("theme preference model", () => {
  it("accepts only the three supported preferences", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("midnight")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it("resolves explicit preferences over the OS setting", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("round-trips storage and treats system as absence", () => {
    storeThemePreference("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredThemePreference()).toBe("dark");

    storeThemePreference("system");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readStoredThemePreference()).toBe("system");
  });

  it("falls back to system on garbage stored values", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
    expect(readStoredThemePreference()).toBe("system");
  });
});

describe("themed route scope", () => {
  it("themes only the /app and /search shells", () => {
    expect(isThemedPath("/app")).toBe(true);
    expect(isThemedPath("/app/watchlists")).toBe(true);
    expect(isThemedPath("/search")).toBe(true);
    expect(isThemedPath("/search/results")).toBe(true);
  });

  it("never themes marketing, auth, legal, or share surfaces", () => {
    for (const path of ["/", "/pricing", "/auth/login", "/terms", "/share/abc", "/help", "/applesauce"]) {
      expect(isThemedPath(path), path).toBe(false);
    }
  });
});

describe("applyTheme", () => {
  it("sets the dark attribute and theme-color meta on themed routes", () => {
    storeThemePreference("dark");
    expect(applyTheme("/app/watchlists")).toBe("dark");
    expect(document.documentElement.getAttribute("data-f9-theme")).toBe("dark");
    expect(
      document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    ).toBe(THEME_COLOR_DARK);
  });

  it("removes the attribute again on marketing routes even when dark is stored", () => {
    storeThemePreference("dark");
    applyTheme("/app");
    expect(applyTheme("/")).toBe("light");
    expect(document.documentElement.hasAttribute("data-f9-theme")).toBe(false);
    expect(
      document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    ).toBe(THEME_COLOR_LIGHT);
  });

  it("stays light on themed routes when the stored preference is light", () => {
    storeThemePreference("light");
    expect(applyTheme("/app")).toBe("light");
    expect(document.documentElement.hasAttribute("data-f9-theme")).toBe(false);
  });
});

describe("pre-paint boot script", () => {
  it("mirrors applyTheme: storage key, path gate, and meta update", () => {
    expect(THEME_BOOT_SCRIPT).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(THEME_BOOT_SCRIPT).toContain('"/app/"');
    expect(THEME_BOOT_SCRIPT).toContain('"/search/"');
    expect(THEME_BOOT_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_BOOT_SCRIPT).toContain(`"${THEME_COLOR_DARK}"`);
    expect(THEME_BOOT_SCRIPT).toContain('setAttribute("data-f9-theme","dark")');
  });

  it("applies dark before paint on a themed route when stored dark", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.history.replaceState(null, "", "/app/watchlists");
    // eslint-disable-next-line no-eval -- exercising the literal inline script
    (0, eval)(THEME_BOOT_SCRIPT);
    expect(document.documentElement.getAttribute("data-f9-theme")).toBe("dark");
  });

  it("never adds the attribute on marketing routes", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.history.replaceState(null, "", "/pricing");
    // eslint-disable-next-line no-eval -- exercising the literal inline script
    (0, eval)(THEME_BOOT_SCRIPT);
    expect(document.documentElement.hasAttribute("data-f9-theme")).toBe(false);
  });
});
