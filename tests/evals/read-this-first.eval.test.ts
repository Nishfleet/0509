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
  if (typeof row.subject?.id !== "string" || typeof row.subject?.role !== "string") {
    throw new Error(`case ${index} has no subject identity`);
  }
  if (typeof row.item?.kind !== "string" || typeof row.item?.observed_at !== "string") {
    throw new Error(`case ${index} has no item`);
  }
  if (row.item.title !== null && typeof row.item.title !== "string") {
    throw new Error(`case ${index} has a malformed item.title`);
  }
  if (!Array.isArray(row.competitors)) throw new Error(`case ${index} has no competitors`);
  for (const [position, entity] of row.competitors.entries()) {
    if (
      typeof entity?.id !== "string" ||
      typeof entity?.role !== "string" ||
      typeof entity?.name !== "string" ||
      typeof entity?.domain !== "string"
    ) {
      throw new Error(`case ${index} competitor ${position} is malformed`);
    }
  }
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

describe("read_this_first state builder", () => {
  it("packs exactly the state the standing worker sends Jev", () => {
    expect(
      readThisFirstState({
        item: {
          kind: "change",
          title: "Adidas raises flagship shoe prices 12%",
          summary: "A 12% increase lands this week.",
          url: "https://example.com/a",
          aspect: null,
          observed_at: "2026-09-20T10:00:00.000Z",
        },
        itemEntityId: "ent_adidas",
        entity: { id: "ent_adidas", role: "competitor", name: "Adidas", domain: "adidas.com" },
        self: { name: "Nike", domain: "nike.com" },
        entities: [
          { id: "ent_puma", role: "competitor", name: "Puma", domain: "puma.com" },
          { id: "ent_adidas", role: "competitor", name: "Adidas", domain: "adidas.com" },
        ],
      }),
    ).toEqual({
      self: { name: "Nike", domain: "nike.com" },
      subject: { name: "Adidas", domain: "adidas.com" },
      competitor_set: ["puma.com"],
      item: {
        kind: "change",
        title: "Adidas raises flagship shoe prices 12%",
        summary: "A 12% increase lands this week.",
        url: "https://example.com/a",
        aspect: null,
        observed_at: "2026-09-20T10:00:00.000Z",
      },
    });
  });
});

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
    const report = await runEval("read_this_first", ask, await loadCasesAs("read_this_first", parseReadThisFirstCase));
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
