import { describe, expect, it } from "vitest";

import {
  READ_THIS_FIRST,
  readThisFirstState,
  type ReadThisFirstEntity,
  type ReadThisFirstItem,
} from "../../app/lib/read-this-first";
import { formatReport, jevKeyPresent, loadCasesAs, makeAsk, runEval, type Ask, type EvalCaseBase } from "./harness";

/**
 * The weekly "read this first" question, scored on the shipped wording.
 *
 * The question constant and the state builder come from app/lib, which is what
 * workers/standing/read-this-first.ts itself asks, so a wording edit and the
 * eval that measures it move together (0509#6163).
 */

interface ReadThisFirstCase extends EvalCaseBase {
  self: { name: string; domain: string } | null;
  subject: ReadThisFirstEntity;
  competitors: { id: string; role: string; name: string; domain: string }[];
  item: ReadThisFirstItem;
}

function parseReadThisFirstCase(raw: Record<string, unknown>, index: number): ReadThisFirstCase {
  const row = raw as unknown as ReadThisFirstCase;
  if (typeof row.subject?.name !== "string" || typeof row.subject?.domain !== "string") {
    throw new Error(`case ${index} has no subject`);
  }
  if (typeof row.item?.kind !== "string" || typeof row.item?.observed_at !== "string") {
    throw new Error(`case ${index} has no item`);
  }
  if (!Array.isArray(row.competitors)) throw new Error(`case ${index} has no competitors`);
  if (row.self !== null && (typeof row.self?.name !== "string" || typeof row.self?.domain !== "string")) {
    throw new Error(`case ${index} has a malformed self`);
  }
  return row;
}

function entitiesFor(row: ReadThisFirstCase): ReadThisFirstEntity[] {
  return [...row.competitors, row.subject];
}

function selfFor(row: ReadThisFirstCase): { name: string; domain: string } | null {
  const self = row.competitors.find((entity) => entity.role === "self");
  if (self !== undefined) return { name: self.name, domain: self.domain };
  return row.self;
}

describe.skipIf(!jevKeyPresent())("eval: read_this_first against Jev", () => {
  it("read_this_first: scores the shipped READ_THIS_FIRST text on both splits", async () => {
    const askOne = await makeAsk(READ_THIS_FIRST);
    const ask: Ask<ReadThisFirstCase> = async (row) =>
      askOne(
        readThisFirstState({
          item: row.item,
          itemEntityId: row.subject.id,
          entity: row.subject,
          self: selfFor(row),
          entities: entitiesFor(row),
        }),
      );
    const report = await runEval(
      "read_this_first",
      ask,
      await loadCasesAs("read_this_first", parseReadThisFirstCase),
    );
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
