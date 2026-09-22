const HOUR_MS = 60 * 60 * 1000;

export function assertSingleRecipient(targets: readonly unknown[]): void {
  if (targets.length > 1) {
    throw new Error(
      "A workspace has two send_target rows for one channel. signal_delivery is unique on (signal_id, channel_id), so widen that key before a second recipient can ship.",
    );
  }
}

export function digestIdempotencyKey(digestId: string, sendTargetId: string): string {
  return `digest:${digestId}:${sendTargetId}`;
}

export function incidentIdempotencyKey(incidentId: string, notice: "open" | "fixed"): string {
  return `incident:${incidentId}:${notice}`;
}

export function quotedSignalIds(marks: readonly { signal_id: string }[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const mark of marks) {
    if (seen.has(mark.signal_id)) continue;
    seen.add(mark.signal_id);
    ids.push(mark.signal_id);
  }
  return ids;
}

export function isStalePending(attemptedAt: string, now: Date, maxAgeMs = HOUR_MS): boolean {
  const then = Date.parse(attemptedAt);
  if (Number.isNaN(then)) return true;
  return now.getTime() - then >= maxAgeMs;
}

export function jobFromIdempotencyKey(key: string): { digest_id: string } | { incident_id: string; resolution?: boolean } | null {
  const digest = /^digest:([^:]+):[^:]+$/.exec(key);
  if (digest?.[1]) return { digest_id: digest[1] };
  const open = /^incident:([^:]+):open$/.exec(key);
  if (open?.[1]) return { incident_id: open[1] };
  const fixed = /^incident:([^:]+):fixed$/.exec(key);
  if (fixed?.[1]) return { incident_id: fixed[1], resolution: true };
  return null;
}
