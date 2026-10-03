import { describe, expect, it } from "vitest";

import {
  D4_QUESTION_ID,
  pickReadThisFirst,
  readThisFirstLine,
  readThisFirstState,
  type D4Verdict,
  type ReadThisFirstEntity,
  type ReadThisFirstItem,
} from "../../app/lib/read-this-first";

const verdict = (signalId: string, p: number, observedAt: string): D4Verdict => ({
  signalId,
  p,
  observedAt,
});

describe("pickReadThisFirst", () => {
  it("drops anything below the 0.5 gate and keeps exactly 0.5", () => {
    expect(
      pickReadThisFirst([
        verdict("a", 0.49, "2026-09-20T00:00:00.000Z"),
        verdict("b", 0.5, "2026-09-20T00:00:00.000Z"),
      ]),
    ).toEqual(["b"]);
  });

  it("orders by p descending", () => {
    expect(
      pickReadThisFirst([
        verdict("low", 0.6, "2026-09-20T00:00:00.000Z"),
        verdict("high", 0.9, "2026-09-20T00:00:00.000Z"),
        verdict("mid", 0.7, "2026-09-20T00:00:00.000Z"),
      ]),
    ).toEqual(["high", "mid", "low"]);
  });

  it("breaks a tie on p with the newer observedAt first", () => {
    expect(
      pickReadThisFirst([
        verdict("older", 0.8, "2026-09-18T00:00:00.000Z"),
        verdict("newer", 0.8, "2026-09-19T00:00:00.000Z"),
      ]),
    ).toEqual(["newer", "older"]);
  });

  it("returns the first three when five clear the gate", () => {
    const verdicts = [
      verdict("first", 0.95, "2026-09-21T00:00:00.000Z"),
      verdict("second", 0.9, "2026-09-21T00:00:00.000Z"),
      verdict("third", 0.85, "2026-09-21T00:00:00.000Z"),
      verdict("fourth", 0.8, "2026-09-21T00:00:00.000Z"),
      verdict("fifth", 0.75, "2026-09-21T00:00:00.000Z"),
    ];
    expect(pickReadThisFirst(verdicts)).toEqual(["first", "second", "third"]);
  });

  it("returns an empty list when nothing clears the gate", () => {
    expect(pickReadThisFirst([verdict("a", 0.1, "2026-09-21T00:00:00.000Z")])).toEqual([]);
    expect(pickReadThisFirst([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const verdicts: D4Verdict[] = [
      verdict("a", 0.6, "2026-09-18T00:00:00.000Z"),
      verdict("b", 0.9, "2026-09-21T00:00:00.000Z"),
      verdict("c", 0.4, "2026-09-19T00:00:00.000Z"),
    ];
    const copy = verdicts.map((v) => ({ ...v }));
    pickReadThisFirst(verdicts);
    expect(verdicts).toEqual(copy);
  });
});

describe("readThisFirstLine", () => {
  it("names the counts and the lead", () => {
    expect(readThisFirstLine(2, 5, "Acme")).toBe("2 of 5 changes worth reading this week, led by Acme.");
  });

  it("says change, not changes, when one change was judged", () => {
    expect(readThisFirstLine(1, 1, "Acme")).toBe("1 of 1 change worth reading this week, led by Acme.");
  });

  it("keeps the plural noun when one of several was picked", () => {
    expect(readThisFirstLine(1, 3, "Acme")).toBe("1 of 3 changes worth reading this week, led by Acme.");
  });
});

describe("readThisFirstState", () => {
  const item: ReadThisFirstItem = {
    kind: "change",
    title: "Adidas raises flagship shoe prices 12%",
    summary: "A 12% increase lands this week.",
    url: "https://example.com/a",
    aspect: null,
    observed_at: "2026-09-20T10:00:00.000Z",
  };

  const entity = (id: string, role: string, name: string, domain: string): ReadThisFirstEntity => ({
    id,
    role,
    name,
    domain,
  });

  const base = {
    item,
    itemEntityId: "ent_adidas",
    entity: entity("ent_adidas", "competitor", "Adidas", "adidas.com"),
    self: { name: "Nike", domain: "nike.com" },
    entities: [
      entity("ent_puma", "competitor", "Puma", "puma.com"),
      entity("ent_adidas", "competitor", "Adidas", "adidas.com"),
      entity("ent_nike", "self", "Nike", "nike.com"),
    ],
  };

  it("packs exactly the state the standing worker sends Jev", () => {
    expect(readThisFirstState(base)).toEqual({
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

  it("keeps only competitor entities and drops the entity the item belongs to", () => {
    const state = readThisFirstState({
      ...base,
      entities: [
        entity("ent_puma", "competitor", "Puma", "puma.com"),
        entity("ent_adidas", "competitor", "Adidas", "adidas.com"),
        entity("ent_nike", "self", "Nike", "nike.com"),
        entity("ent_other", "supplier", "Supplier Co", "supplier.example"),
      ],
    }) as { competitor_set: string[] };
    expect(state.competitor_set).toEqual(["puma.com"]);
  });

  it("keeps the domains of every other competitor, in order", () => {
    const state = readThisFirstState({
      ...base,
      itemEntityId: "ent_nowhere",
      entities: [
        entity("ent_puma", "competitor", "Puma", "puma.com"),
        entity("ent_adidas", "competitor", "Adidas", "adidas.com"),
        entity("ent_nike", "self", "Nike", "nike.com"),
        entity("ent_reebok", "competitor", "Reebok", "reebok.com"),
      ],
    }) as { competitor_set: string[] };
    expect(state.competitor_set).toEqual(["puma.com", "adidas.com", "reebok.com"]);
  });

  it("sends the subject entity as name and domain only", () => {
    const state = readThisFirstState(base) as { subject: unknown };
    expect(state.subject).toEqual({ name: "Adidas", domain: "adidas.com" });
    expect(Object.keys(state.subject as object).sort()).toEqual(["domain", "name"]);
  });

  it("carries the six item fields and drops anything else on the input item", () => {
    const state = readThisFirstState({
      ...base,
      item: { ...item, id: "sig_1", entity_id: "ent_adidas", source_url: "https://example.com/a" },
    }) as { item: unknown };
    expect(state.item).toEqual({
      kind: "change",
      title: "Adidas raises flagship shoe prices 12%",
      summary: "A 12% increase lands this week.",
      url: "https://example.com/a",
      aspect: null,
      observed_at: "2026-09-20T10:00:00.000Z",
    });
    expect(Object.keys(state.item as object).sort()).toEqual([
      "aspect",
      "kind",
      "observed_at",
      "summary",
      "title",
      "url",
    ]);
  });

  it("passes a null self through as null and a real self through unchanged", () => {
    const withoutSelf = readThisFirstState({ ...base, self: null }) as { self: unknown };
    expect(withoutSelf.self).toBeNull();
    const withSelf = readThisFirstState(base) as { self: unknown };
    expect(withSelf.self).toEqual({ name: "Nike", domain: "nike.com" });
  });

  it("gives an empty competitor set when there are no entities", () => {
    const state = readThisFirstState({ ...base, entities: [] }) as { competitor_set: string[] };
    expect(state.competitor_set).toEqual([]);
  });
});

describe("public contract", () => {
  it("names the D4 question", () => {
    expect(D4_QUESTION_ID).toBe("read_this_first");
  });
});
