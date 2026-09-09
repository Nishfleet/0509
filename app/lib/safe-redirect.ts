// Only same-origin paths are safe redirect targets. Absolute URLs,
// scheme-relative `//host` values, and `/\host` (which browsers normalize to
// `//host`) would let a crafted ?redirectTo= bounce a user to an attacker's
// site after login — a classic open-redirect phishing vector.
//
// ASCII control characters (U+0000–U+001F, U+007F) are rejected first.
// Browsers strip TAB/LF/CR from URLs, so `/\t/evil.com` would otherwise
// pass the prefix checks and then become `//evil.com`.
const ASCII_CONTROL = /[\u0000-\u001F\u007F]/;

export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  if (ASCII_CONTROL.test(value)) {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }

  return value;
}
