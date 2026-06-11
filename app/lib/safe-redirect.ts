// Only same-origin paths are safe redirect targets. Absolute URLs,
// scheme-relative `//host` values, and `/\host` (which browsers normalize to
// `//host`) would let a crafted ?redirectTo= bounce a user to an attacker's
// site after login — a classic open-redirect phishing vector.
export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }

  return value;
}
