import { createCookie } from "react-router";

const TIMEZONE_COOKIE = "timezone";

export const timezoneCookie = createCookie(TIMEZONE_COOKIE, {
  path: "/",
  sameSite: "lax",
  maxAge: 60 * 60 * 24 * 365,
});

export async function timezoneCookieValue(header: string | null): Promise<string | null> {
  const parsed: unknown = await timezoneCookie.parse(header);
  if (typeof parsed !== "string") return null;
  const value = parsed.trim();
  return value.length > 0 ? value : null;
}

export function canonicalTimezone(value: string | null | undefined): string {
  if (!value) return "UTC";
  const zone = value.trim();
  if (zone.length === 0 || zone.length > 100) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return zone;
  } catch (error) {
    console.error(JSON.stringify({ event: "timezone.resolve_failed", error: String(error) }));
    return "UTC";
  }
}

export function sameTimezone(left: string, right: string): boolean {
  const leftZone = left.trim();
  const rightZone = right.trim();
  if (leftZone.length === 0 || rightZone.length === 0) return false;
  if (canonicalTimezone(leftZone) === "UTC" && leftZone !== "UTC") return false;
  if (canonicalTimezone(rightZone) === "UTC" && rightZone !== "UTC") return false;
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: leftZone }).resolvedOptions().timeZone ===
    new Intl.DateTimeFormat("en-US", { timeZone: rightZone }).resolvedOptions().timeZone
  );
}
