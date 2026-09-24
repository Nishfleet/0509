export interface AgentKey {
  id: string;
  name: string;
  start: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ConnectedApp {
  grantId: string;
  name: string;
  connectedAt: string;
}
