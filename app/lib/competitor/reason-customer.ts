const REASON_LINES: Readonly<Record<string, string>> = {
  active: "We're not sure it still competes with you",
  acquired: "Looks like it was acquired",
  shut_down: "Looks like it shut down",
  pivoted: "Looks like it changed what it sells",
  dormant: "Quiet for the last 30 days",
};

export function retireReasonLine(code: string): string {
  return REASON_LINES[code];
}

export function pausedReasonLine(code: string | null): string | undefined {
  if (code === null) return undefined;
  if (code !== "acquired" && code !== "shut_down") return undefined;
  const line = REASON_LINES[code];
  return `${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}
