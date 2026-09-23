import { env } from "cloudflare:workers";

import { briefText } from "../delivery-alert";

export interface DeliveryFailureRow {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  brief_text: string;
}

interface AlertJoinRow {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  payload_json: string | null;
}

const SELECT_DELIVERY_FAILURES = `SELECT a.id, a.title, a.body, a.created_at, d.payload_json
FROM alert a
LEFT JOIN digest d ON d.id = substr(a.id, 5) AND d.workspace_id = a.workspace_id
WHERE a.workspace_id = ? AND a.kind = 'delivery_failed'
ORDER BY a.created_at DESC
LIMIT 20`;

export async function readDeliveryFailures(workspaceId: string): Promise<DeliveryFailureRow[]> {
  const { results } = await env.DB.prepare(SELECT_DELIVERY_FAILURES)
    .bind(workspaceId)
    .all<AlertJoinRow>();
  return results.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    created_at: row.created_at,
    brief_text: briefText(row.payload_json),
  }));
}
