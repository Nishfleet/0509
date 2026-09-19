import { describe, expect, it, vi } from "vitest";

import {
  CRAWLER_CHOICE_MODEL,
  CRAWLER_CHOICE_SITE,
  CRAWLER_CHOICE_STOP,
  CrawlerChoiceAnswerError,
  buildCrawlerChoiceQuestion,
  crawlerChoiceOfferedIds,
  crawlerChoiceStateSha256,
  decideCrawlerChoice,
  shadowLogCrawlerChoice,
  stableJson,
  summarizeCrawlerChoiceRows,
  type CrawlerChoiceAi,
  type CrawlerChoiceRow,
} from "../app/lib/crawler-choice-jev.server";

/** A binding that answers with the first offered candidate, validly. */
function fakeAi(
  overrides: {
    choice?: string;
    probabilities?: Record<string, number>;
    confidence?: number;
    usage?: { input_tokens: number; output_tokens: number };
    model?: string;
  } = {},
): CrawlerChoiceAi {
  return {
    async run(model, input) {
      const questions = input.questions as {
        action: { criteria: Record<string, string> };
      };
      const offered = Object.keys(questions.action.criteria);
      const choice = overrides.choice ?? offered[0]!;
      const probabilities = overrides.probabilities ?? distribution(offered, choice);
      return {
        answers: {
          action: {
            type: "choice",
            choice,
            probabilities,
            confidence: overrides.confidence ?? 0.8,
          },
        },
        usage: overrides.usage ?? { input_tokens: 100, output_tokens: 10 },
        model: overrides.model ?? "fake",
      };
    },
  };
}

function distribution(ids: readonly string[], choice: string): Record<string, number> {
  const other = (1 - 0.8) / Math.max(1, ids.length - 1);
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = id === choice ? 0.8 : other;
  return out;
}

const page = {
  url: "https://example.invalid/ads",
  title: "Ad Library",
  text: "12 cards visible",
  candidates: [
    { id: "scroll_pass", label: "Scroll to the bottom" },
    { id: "see_more", label: "Click See more" },
  ],
};

describe("buildCrawlerChoiceQuestion", () => {
  it("offers the enumerated candidates plus stop, in order, stop last", () => {
    const { questions } = buildCrawlerChoiceQuestion({
      choicePoint: "meta_library_scroll",
      page,
      scripted: { id: "scroll_pass" },
    });
    const criteria = (questions.action as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(criteria)).toEqual(["scroll_pass", "see_more", CRAWLER_CHOICE_STOP]);
    expect(criteria[CRAWLER_CHOICE_STOP]).toMatch(/Stop crawling/);
  });

  it("keeps candidate detail out of the label but inside the rubric", () => {
    const { questions } = buildCrawlerChoiceQuestion({
      choicePoint: "x",
      page: { ...page, candidates: [{ id: "a", label: "Alpha", detail: "first" }] },
      scripted: { id: "a" },
    });
    const criteria = (questions.action as { criteria: Record<string, string> }).criteria;
    expect(criteria.a).toBe("Alpha — first");
  });

  it("bounds page text so a huge DOM cannot blow the context", () => {
    const { state } = buildCrawlerChoiceQuestion({
      choicePoint: "x",
      page: { ...page, text: "a".repeat(10_000) },
      scripted: { id: "scroll_pass" },
    });
    expect((state as { page: { text: string } }).page.text.length).toBe(4000);
  });

  it("records the scripted choice and recent history in state", () => {
    const { state } = buildCrawlerChoiceQuestion({
      choicePoint: "x",
      page,
      scripted: { id: "scroll_pass" },
      recent: ["scroll_pass"],
    });
    expect(state).toMatchObject({
      scripted_choice: "scroll_pass",
      recent_scripted_choices: ["scroll_pass"],
    });
  });
});

describe("crawlerChoiceOfferedIds", () => {
  it("appends stop once and caps at 40 candidates", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, label: `C${i}` }));
    const ids = crawlerChoiceOfferedIds(many);
    expect(ids).toHaveLength(41);
    expect(ids.at(-1)).toBe(CRAWLER_CHOICE_STOP);
  });
});

describe("decideCrawlerChoice", () => {
  it("logs the crawler's own model id and the fleet row shape", async () => {
    const { row } = await decideCrawlerChoice(fakeAi(), {
      choicePoint: "meta_library_scroll",
      page,
      scripted: { id: "scroll_pass", reason: "pass 1 of 3" },
      ref: "Nishfleet/0509#3618",
    });
    expect(CRAWLER_CHOICE_MODEL).toBe("typesafe/jev");
    expect(row).toMatchObject({
      site: CRAWLER_CHOICE_SITE,
      ref: "Nishfleet/0509#3618",
      choice_point: "meta_library_scroll",
      scripted: "scroll_pass",
      scripted_reason: "pass 1 of 3",
      jev_choice: "scroll_pass",
      agreed: true,
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    expect(row.state_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(row)).toEqual(
      expect.arrayContaining([
        "ts",
        "site",
        "ref",
        "state_sha256",
        "answers",
        "probabilities",
        "usage",
        "ms",
      ]),
    );
  });

  it("marks a disagreement and keeps both picks", async () => {
    const { row } = await decideCrawlerChoice(fakeAi({ choice: "see_more" }), {
      choicePoint: "meta_library_scroll",
      page,
      scripted: { id: "scroll_pass" },
    });
    expect(row.agreed).toBe(false);
    expect(row.scripted).toBe("scroll_pass");
    expect(row.jev_choice).toBe("see_more");
  });

  it("throws on a choice that was not offered", async () => {
    await expect(
      decideCrawlerChoice(fakeAi({ choice: "banana" }), {
        choicePoint: "x",
        page,
        scripted: { id: "scroll_pass" },
      }),
    ).rejects.toThrow(CrawlerChoiceAnswerError);
  });

  it("throws when probabilities do not sum to one", async () => {
    await expect(
      decideCrawlerChoice(
        fakeAi({ probabilities: { scroll_pass: 0.2, see_more: 0.2, stop: 0.2 } }),
        { choicePoint: "x", page, scripted: { id: "scroll_pass" } },
      ),
    ).rejects.toThrow(/sum to/);
  });

  it("throws when the chosen option is not the maximum", async () => {
    await expect(
      decideCrawlerChoice(
        fakeAi({ choice: "see_more", probabilities: { scroll_pass: 0.9, see_more: 0.05, stop: 0.05 } }),
        { choicePoint: "x", page, scripted: { id: "scroll_pass" } },
      ),
    ).rejects.toThrow(/not the maximum-probability option/);
  });

  it("throws when a probability is missing for an offered candidate", async () => {
    await expect(
      decideCrawlerChoice(fakeAi({ probabilities: { scroll_pass: 1 } }), {
        choicePoint: "x",
        page,
        scripted: { id: "scroll_pass" },
      }),
    ).rejects.toThrow(/invalid probability/);
  });
});

describe("shadowLogCrawlerChoice (observe-only)", () => {
  it("returns null and logs nothing when there is no AI binding", async () => {
    const log = vi.fn();
    const row = await shadowLogCrawlerChoice(undefined, {
      choicePoint: "x",
      page,
      scripted: { id: "scroll_pass" },
    }, log);
    expect(row).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("swallows a binding failure and never throws at the crawler", async () => {
    const log = vi.fn();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const failing: CrawlerChoiceAi = {
      async run() {
        throw new Error("binding down");
      },
    };
    const row = await shadowLogCrawlerChoice(
      failing,
      { choicePoint: "x", page, scripted: { id: "scroll_pass" } },
      log,
    );
    expect(row).toBeNull();
    expect(log).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
    const logged = JSON.parse(info.mock.calls[0]![0] as string);
    expect(logged.event).toBe("crawler_choice_shadow_failed");
    expect(logged.message).toBe("binding down");
    info.mockRestore();
  });

  it("emits the row once on success", async () => {
    const log = vi.fn();
    const row = await shadowLogCrawlerChoice(
      fakeAi(),
      { choicePoint: "x", page, scripted: { id: "scroll_pass" } },
      log,
    );
    expect(row).not.toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("state hashing and summaries", () => {
  it("hashes object key order independently", async () => {
    const a = await crawlerChoiceStateSha256({ b: 1, a: [{ y: 2, x: 3 }] });
    const b = await crawlerChoiceStateSha256({ a: [{ x: 3, y: 2 }], b: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stableJson sorts nested keys deterministically", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("summarizes agreement by choice point and returns null for no rows", () => {
    const rows = [
      row({ choice_point: "a", agreed: true }),
      row({ choice_point: "a", agreed: false }),
      row({ choice_point: "b", agreed: true }),
    ];
    const summary = summarizeCrawlerChoiceRows(rows);
    expect(summary.total).toBe(3);
    expect(summary.agreed).toBe(2);
    expect(summary.agreementRate).toBeCloseTo(2 / 3);
    expect(summary.byChoicePoint).toEqual({
      a: { total: 2, agreed: 1 },
      b: { total: 1, agreed: 1 },
    });
    expect(summary.disagreements).toHaveLength(1);
    expect(summarizeCrawlerChoiceRows([]).agreementRate).toBeNull();
  });
});

function row(overrides: Partial<CrawlerChoiceRow>): CrawlerChoiceRow {
  return {
    ts: "2026-09-19T00:00:00.000Z",
    site: CRAWLER_CHOICE_SITE,
    ref: "Nishfleet/0509#3618",
    state_sha256: "0".repeat(64),
    answers: { action: { type: "choice", choice: "scroll_pass" } },
    probabilities: { scroll_pass: 1 },
    usage: { input_tokens: 1, output_tokens: 1 },
    ms: 1,
    choice_point: "meta_library_scroll",
    page_url: "https://example.invalid",
    scripted: "scroll_pass",
    jev_choice: "scroll_pass",
    jev_confidence: 0.8,
    agreed: true,
    candidates: ["scroll_pass", "stop"],
    ...overrides,
  };
}
