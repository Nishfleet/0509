const INSERT_DELIVERIES = `INSERT INTO signal_delivery (id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at)
SELECT lower(hex(randomblob(16))), s.workspace_id, s.id, ?2, ?3, ?4
FROM signal s
WHERE s.workspace_id = ?1 AND s.id IN (SELECT value FROM json_each(?5))
ON CONFLICT (signal_id, channel_id) DO NOTHING`;

export interface SignalDeliveries {
  workspaceId: string;
  channelId: string;
  sendAttemptId: string;
  deliveredAt: string;
  signalIds: readonly string[];
}

export function insertSignalDeliveries(db: D1Database, input: SignalDeliveries): D1PreparedStatement {
  return db
    .prepare(INSERT_DELIVERIES)
    .bind(input.workspaceId, input.channelId, input.sendAttemptId, input.deliveredAt, JSON.stringify(input.signalIds));
}
