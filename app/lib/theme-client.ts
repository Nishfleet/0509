/**
 * Workspace theme (dark mode) — client-side only, no server persistence.
 *
 * The preference lives in localStorage under `f9-theme` as
 * "system" | "light" | "dark" (absent = system). The resolved theme is
 * applied as a `data-f9-theme` attribute on <html>, but ONLY on themed
 * routes (/app and /search shells). Marketing, auth, legal, and share
 * surfaces stay bone/light permanently, so the attribute is removed there
 * even when the stored preference is dark.
 *
 * `THEME_BOOT_SCRIPT` is inlined into <head> in root.tsx so the attribute
 * lands before first paint (no light flash). Keep its logic in sync with
 * `applyTheme` below.
 */

export const THEME_STORAGE_KEY = "f9-theme";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const THEME_COLOR_LIGHT = "#f4f1e8";
export const THEME_COLOR_DARK = "#171611";

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/** Only the workspace + search shells are themed; marketing stays light. */
export function isThemedPath(pathname: string): boolean {
  return (
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname === "/search" ||
    pathname.startsWith("/search/")
  );
}

export function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): "light" | "dark" {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return prefersDark ? "dark" : "light";
}

export function storeThemePreference(preference: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    if (preference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Private mode / storage denied: theme still applies for this page view.
  }
}

/**
 * Apply the resolved theme for the given pathname: set or remove the
 * `data-f9-theme` attribute on <html> and keep the theme-color meta in
 * sync. Safe to call repeatedly (navigation, toggle, media change).
 */
export function applyTheme(pathname: string): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(readStoredThemePreference(), prefersDark);
  const themed = isThemedPath(pathname) && resolved === "dark";
  const html = document.documentElement;
  if (themed) {
    html.setAttribute("data-f9-theme", "dark");
  } else {
    html.removeAttribute("data-f9-theme");
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themed ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  return themed ? "dark" : "light";
}

/**
 * Pre-paint boot script. Mirrors applyTheme() without imports so it can be
 * inlined in <head>. Only ADDS the dark attribute (the server never renders
 * it, so there is nothing to remove before hydration).
 *
 * The storage key and dark theme-color are inlined as literal strings rather
 * than interpolated from the exported constants. Interpolating a value (even
 * a constant) into an executable script string is a code-construction sink
 * (CodeQL `js/bad-code-sanitization`): `JSON.stringify` does not make a value
 * safe to splice into code. The literals below MUST stay in sync with
 * `THEME_STORAGE_KEY` and `THEME_COLOR_DARK` — `tests/theme-client.test.ts`
 * asserts the boot script contains those exact literals, so drifting them
 * fails the test. The stored preference `s` is only ever compared against the
 * fixed allowlist ("dark"/"light"); it never flows into a code-construction
 * sink, so a malicious localStorage value cannot execute.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=null;try{s=localStorage.getItem("f9-theme")}catch(e){}var d=s==="dark"||(s!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var p=location.pathname;var t=p==="/app"||p.indexOf("/app/")===0||p==="/search"||p.indexOf("/search/")===0;if(d&&t){document.documentElement.setAttribute("data-f9-theme","dark");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#171611");}}catch(e){}})();`;
