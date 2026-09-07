import { useEffect, useState } from "react";

import {
  applyTheme,
  isThemePreference,
  readStoredThemePreference,
  storeThemePreference,
  type ThemePreference,
} from "~/lib/theme-client";

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Three-way workspace theme select (System / Light / Dark). Client-only:
 * writes localStorage and applies the theme attribute live — no server
 * persistence. Renders the "system" default on the server and syncs to the
 * stored preference after mount so hydration stays clean.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    setPreference(readStoredThemePreference());
  }, []);

  return (
    <label className="f9-field f9-theme-field">
      <span>Theme</span>
      <select
        aria-label="Workspace theme"
        onChange={(event) => {
          const next = event.target.value;
          if (!isThemePreference(next)) return;
          setPreference(next);
          storeThemePreference(next);
          applyTheme(window.location.pathname);
        }}
        value={preference}
      >
        {THEME_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
