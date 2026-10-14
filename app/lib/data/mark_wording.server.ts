import { env } from "cloudflare:workers";
import { z } from "zod";

import { markFromHunks, parseDiffHunks, type ChangeMark } from "../site-change";

const SELECT_DIFF_KEYS = `SELECT s.id AS id, json_extract(s.payload_json, '$.diffKey') AS diff_key
FROM signal s
WHERE s.workspace_id = ?1 AND s.kind = 'change' AND s.id IN (SELECT value FROM json_each(?2))`;

const diffKeyRows = z.array(z.object({ id: z.string(), diff_key: z.string().nullable() }));

async function readMark(signalId: string, diffKey: string): Promise<[string, ChangeMark] | null> {
  try {
    const stored = await env.SNAPSHOTS.get(diffKey);
    const hunks = stored === null ? null : parseDiffHunks(await stored.text());
    const mark = hunks === null ? null : markFromHunks(hunks);
    return mark === null ? null : [signalId, mark];
  } catch (error) {
    console.warn(JSON.stringify({ event: "brief.mark_wording_failed", signal_id: signalId, error: String(error) }));
    return null;
  }
}

export async function readMarkWording(
  db: D1Database,
  input: { workspaceId: string; signalIds: readonly string[] },
): Promise<ReadonlyMap<string, ChangeMark>> {
  if (input.signalIds.length === 0) return new Map();
  const { results } = await db.prepare(SELECT_DIFF_KEYS).bind(input.workspaceId, JSON.stringify(input.signalIds)).all();
  const rows = diffKeyRows.parse(results);
  const marks = await Promise.all(
    rows.flatMap((row) => (row.diff_key === null ? [] : [readMark(row.id, row.diff_key)])),
  );
  return new Map(marks.flatMap((entry) => (entry === null ? [] : [entry])));
}
