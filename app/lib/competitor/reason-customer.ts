const REASON_LINES = {
  active: "We're not sure it still competes with you",
  acquired: "Looks like it was acquired",
  shut_down: "Looks like it shut down",
  pivoted: "Looks like it changed what it sells",
  dormant: "Quiet for the last 30 days",
} as const satisfies Readonly<Record<string, string>>;

function isReasonCode(code: string): code is keyof typeof REASON_LINES {
  return Object.hasOwn(REASON_LINES, code);
}

export function retireReasonLine(code: string): string {
  return isReasonCode(code) ? REASON_LINES[code] : REASON_LINES.active;
}

export function pausedReasonLine(code: string | null): string | undefined {
  if (code === null) return undefined;
  if (code !== "acquired" && code !== "shut_down") return undefined;
  const line = REASON_LINES[code];
  return `${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}
