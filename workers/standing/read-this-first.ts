import { z } from "zod";

import { insertVerdict } from "../../app/lib/data/jev_verdict.server";
import type { NoulQuestion, NoulVerdict } from "../../app/lib/jev/client.server";
import { askNoul, JevUnavailableError } from "../../app/lib/jev/client.server";
import type { D4Verdict } from "../../app/lib/read-this-first";
import { D4_QUESTION_ID, pickReadThisFirst } from "../../app/lib/read-this-first";
import { D3_QUESTION_ID, D6_QUESTION_ID } from "../../app/lib/standing-score";

const JUDGE_CHUNK = 10;

export const READ_THIS_FIRST: NoulQuestion = {
  id: D4_QUESTION_ID,
  instructions:
    "Does this item belong in the three things this brand's owner should read first this week?",
  whenTrue: "It would change what the owner does or thinks about a competitor this week.",
  whenFalse: "It is routine and can wait for the full list.",
};

const WEEK_ITEMS = `SELECT s.id AS signal_id, s.entity_id AS entity_id, s.kind AS kind, s.title AS title, s.summary AS summary,
       s.url AS url, s.aspect AS aspect, s.observed_at AS observed_at
FROM signal s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = ?1 AND e.state = 'on'
WHERE s.workspace_id = ?1 AND s.observed_at >= ?2 AND s.observed_at < ?3 AND s.is_tombstoned = 0
  AND EXISTS (SELECT 1 FROM jev_verdict v WHERE v.signal_id = s.id AND v.question_id IN (?4, ?5) AND v.p >= 0.9)
ORDER BY s.observed_at DESC, s.id ASC
LIMIT 50`;

const ON_ENTITIES = `SELECT id, role, COALESCE(NULLIF(name, ''), domain) AS name, domain FROM entity WHERE workspace_id = ?1 AND state = 'on' ORDER BY domain ASC`;

const weekItemRows = z.array(
  z.object({
    signal_id: z.string(),
    entity_id: z.string(),
    kind: z.string(),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    url: z.string().nullable(),
    aspect: z.string().nullable(),
    observed_at: z.string(),
  }),
);

const entityRows = z.array(
  z.object({
    id: z.string(),
    role: z.string(),
    name: z.string(),
    domain: z.string(),
  }),
);

type WeekItemRow = z.infer<typeof weekItemRows>[number];
type EntityRow = z.infer<typeof entityRows>[number];

export interface JudgeWeekInput {
  workspaceId: string;
  startsAt: string;
  closesAt: string;
  decidedAt: string;
}

export interface JudgedWeek {
  picks: string[];
  judged: number;
}

interface LocatedItem {
  item: WeekItemRow;
  entity: EntityRow;
}

function subjectOf(entity: EntityRow): { name: string; domain: string } {
  return { name: entity.name, domain: entity.domain };
}

function competitorSet(entities: readonly EntityRow[], entityId: string): string[] {
  return entities
    .filter((entity) => entity.role === "competitor" && entity.id !== entityId)
    .map((entity) => entity.domain);
}

function packFor(
  located: LocatedItem,
  self: { name: string; domain: string } | null,
  entities: readonly EntityRow[],
): unknown {
  const { item, entity } = located;
  return {
    self,
    subject: subjectOf(entity),
    competitor_set: competitorSet(entities, item.entity_id),
    item: {
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      url: item.url,
      aspect: item.aspect,
      observed_at: item.observed_at,
    },
  };
}

export async function judgeWeek(db: D1Database, input: JudgeWeekInput): Promise<JudgedWeek> {
  const [weekItemResult, entityResult] = await db.batch([
    db.prepare(WEEK_ITEMS).bind(
      input.workspaceId,
      input.startsAt,
      input.closesAt,
      D3_QUESTION_ID,
      D6_QUESTION_ID,
    ),
    db.prepare(ON_ENTITIES).bind(input.workspaceId),
  ]);
  const items = weekItemRows.parse(weekItemResult.results);
  const entities = entityRows.parse(entityResult.results);
  if (items.length === 0) {
    return { picks: [], judged: 0 };
  }
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const located = items.flatMap((item) => {
    const entity = byId.get(item.entity_id);
    return entity === undefined ? [] : [{ item, entity }];
  });
  const selfEntity = entities.find((entity) => entity.role === "self");
  const self = selfEntity === undefined ? null : subjectOf(selfEntity);

  let collected: D4Verdict[] = [];
  try {
    for (let index = 0; index < located.length; index += JUDGE_CHUNK) {
      const chunk = located.slice(index, index + JUDGE_CHUNK);
      const verdicts: NoulVerdict[] = await Promise.all(
        chunk.map((entry) => askNoul(input.workspaceId, READ_THIS_FIRST, packFor(entry, self, entities))),
      );
      const statements = chunk.flatMap((entry, position) => {
        const verdict = verdicts[position];
        if (verdict.cached) return [];
        return [
          insertVerdict({
            workspaceId: input.workspaceId,
            questionId: verdict.questionId,
            inputHash: verdict.inputHash,
            signalId: entry.item.signal_id,
            entityId: entry.item.entity_id,
            p: verdict.p,
            choice: null,
            reason: null,
            decidedAt: input.decidedAt,
          }),
        ];
      });
      if (statements.length > 0) {
        await db.batch(statements);
      }
      collected = [
        ...collected,
        ...chunk.map((entry, position) => ({
          signalId: entry.item.signal_id,
          p: verdicts[position].p,
          observedAt: entry.item.observed_at,
        })),
      ];
    }
  } catch (error) {
    if (error instanceof JevUnavailableError) {
      return { picks: [], judged: 0 };
    }
    throw error;
  }
  return { picks: pickReadThisFirst(collected), judged: items.length };
}
