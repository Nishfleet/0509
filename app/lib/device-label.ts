const BROWSERS: readonly (readonly [string, string])[] = [
  ["Edg/", "Edge"],
  ["EdgA/", "Edge"],
  ["OPR/", "Opera"],
  ["Firefox/", "Firefox"],
  ["FxiOS/", "Firefox"],
  ["CriOS/", "Chrome"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
];

const SYSTEMS: readonly (readonly [string, string])[] = [
  ["iPhone", "iPhone"],
  ["iPad", "iPad"],
  ["Android", "Android"],
  ["Windows", "Windows"],
  ["Mac OS X", "Mac"],
  ["CrOS", "ChromeOS"],
  ["Linux", "Linux"],
];

function firstMatch(table: readonly (readonly [string, string])[], userAgent: string): string | null {
  const hit = table.find(([token]) => userAgent.includes(token));
  return hit === undefined ? null : hit[1];
}

export function deviceLabel(userAgent: string | null): string {
  if (userAgent === null) return "Unknown device";
  const browser = firstMatch(BROWSERS, userAgent);
  const system = firstMatch(SYSTEMS, userAgent);
  if (browser !== null && system !== null) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown device";
}

export interface DeviceItem {
  id: string;
  label: string;
  lastActive: string | null;
  current: boolean;
}
