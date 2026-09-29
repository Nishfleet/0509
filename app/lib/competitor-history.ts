export function historyAnchor(state: "on" | "off", stateChangedAt: string | null, now: Date): Date {
  if (state === "on" || stateChangedAt === null) return now;
  const pausedAt = new Date(stateChangedAt);
  return pausedAt.getTime() < now.getTime() ? pausedAt : now;
}
