interface FunnelWeek {
  week: string;
  signed_up: number;
  started: number;
  trialing: number;
  paying: number;
  cancelled: number;
}

export interface RetentionBoard {
  funnel: FunnelWeek[];
  lastSeen: { week: number; drifting: number; away: number; never: number };
  cancellations: { month: string; cancelled: number }[];
  emails: { kind: string; sent: number; visited: number }[];
}

export function percent(part: number, whole: number): string {
  return whole === 0 ? "-" : `${String(Math.round((part / whole) * 100))}%`;
}
