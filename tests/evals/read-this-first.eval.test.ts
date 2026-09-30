import { describe, expect, it } from "vitest";

import {
  READ_THIS_FIRST,
  readThisFirstState,
  type ReadThisFirstEntity,
  type ReadThisFirstItem,
} from "../../app/lib/read-this-first";
import {
  formatReport,
  jevKeyPresent,
  loadCases,
  makeNoulAsk,
  noulScore,
  runEval,
  type Ask,
  type NoulEvalRow,
} from "./harness";

/**
 * The weekly "read this first" question, scored on the shipped wording.
 *
 * The question constant and the state builder come from app/lib, which is what
 * workers/standing/read-this-first.ts itself asks, so a wording edit and the
 * eval that measures it move together (0509#6163).
 */

interface ReadThisFirstCase extends NoulEvalRow {
  self: { name: string; domain: string } | null;
  subject: ReadThisFirstEntity;
  competitors: { id: string; role: string; name: string; domain: string }[];
  item: ReadThisFirstItem;
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
    const rows = await loadCases<ReadThisFirstCase>("read_this_first", ["subject", "competitors", "item"]);
    const askOne = makeNoulAsk(READ_THIS_FIRST);
    const ask: Ask<ReadThisFirstCase> = (row) =>
      askOne(
        readThisFirstState({
          item: row.item,
          itemEntityId: row.subject.id,
          entity: row.subject,
          self: selfFor(row),
          entities: entitiesFor(row),
        }),
      );
    const report = await runEval("read_this_first", rows, ask, noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
