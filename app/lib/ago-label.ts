export function agoLabel(observedAt: string, now: Date): string {
  const elapsed = now.getTime() - Date.parse(observedAt);
  if (!Number.isFinite(elapsed)) {
    return "date unknown";
  }
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  if (minutes < 1440) return `${String(Math.floor(minutes / 60))}h ago`;
  return `${String(Math.floor(minutes / 1440))}d ago`;
}
