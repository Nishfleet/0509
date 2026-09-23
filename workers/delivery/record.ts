export function quotedSignalIds(payloadJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const readThisFirst = (parsed as { read_this_first?: unknown }).read_this_first;
  if (!Array.isArray(readThisFirst)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of readThisFirst) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const signalId = (entry as { signal_id?: unknown }).signal_id;
    if (typeof signalId === "string" && signalId.length > 0) {
      ids.push(signalId);
    }
  }
  return [...new Set(ids)];
}

export function signalDeliveryStatements(
  db: D1Database,
  workspaceId: string,
  channelId: string,
  attemptId: string,
  signalIds: string[],
  deliveredAt: string,
): D1PreparedStatement[] {
  return signalIds.map((signalId) =>
    db
      .prepare(
        "INSERT INTO signal_delivery (id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(signal_id, channel_id) DO NOTHING",
      )
      .bind(crypto.randomUUID(), workspaceId, signalId, channelId, attemptId, deliveredAt),
  );
}
