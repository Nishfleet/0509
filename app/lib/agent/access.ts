export interface AgentKey {
  id: string;
  name: string;
  start: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  rateLimitMax: number | null;
  remaining: number | null;
}

export interface ConnectedApp {
  grantId: string;
  name: string;
  connectedAt: string;
}
