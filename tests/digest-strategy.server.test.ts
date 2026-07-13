import { describe, expect, it, vi } from "vitest";

import { DIGEST_STRATEGY_MODEL, readDigestStrategyNote } from "~/lib/digest-strategy";
import {
  buildStrategyInputLines,
  buildWeeklyStrategyParagraph,
  validateStrategyParagraph,
} from "~/lib/digest-strategy.server";

const GOOD_PARAGRAPH =
  "Nykaa refreshed its landing page discount while boAt introduced new festival-focused ads. " +
  "Most of this week's movement centered on pricing and offers, with one creative swap on top.";

function strategyItem(overrides: Record<string, unknown> = {}) {
  return {
    watchlistName: "Nykaa watch",
    title: "Landing page offer changed",
    summary: "Offer changed on the landing page.",
    metadata: { priorityScore: 80, sourceStatus: "proof_backed" },
    ...overrides,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    items: [strategyItem()],
    totalChanges: 1,
    watchlistCount: 1,
    periodStart: "2026-07-06T05:00:00.000Z",
    periodEnd: "2026-07-13T05:00:00.000Z",
    ...overrides,
  };
}

describe("buildWeeklyStrategyParagraph", () => {
  it("returns the validated paragraph on good model output", async () => {
    const run = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);
    const paragraph = await buildWeeklyStrategyParagraph(
      { AI: { run } } as never,
      baseInput(),
    );

    expect(paragraph).toBe(GOOD_PARAGRAPH);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      DIGEST_STRATEGY_MODEL,
      expect.objectContaining({
        max_tokens: 200,
        messages: [
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Nykaa watch: Landing page offer changed"),
          }),
        ],
      }),
    );
  });

  it("normalizes the { response } object shape like detectLanguageCode", async () => {
    const run = vi.fn().mockResolvedValue({ response: GOOD_PARAGRAPH });
    const paragraph = await buildWeeklyStrategyParagraph(
      { AI: { run } } as never,
      baseInput(),
    );

    expect(paragraph).toBe(GOOD_PARAGRAPH);
  });

  it("returns null when the AI binding is missing", async () => {
    const paragraph = await buildWeeklyStrategyParagraph({} as never, baseInput());
    expect(paragraph).toBeNull();
  });

  it("returns null instead of throwing when the model call fails", async () => {
    const run = vi.fn().mockRejectedValue(new Error("model unavailable"));
    await expect(
      buildWeeklyStrategyParagraph({ AI: { run } } as never, baseInput()),
    ).resolves.toBeNull();
  });

  it("returns null when there are no usable item lines", async () => {
    const run = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);
    const paragraph = await buildWeeklyStrategyParagraph(
      { AI: { run } } as never,
      baseInput({
        items: [strategyItem({ watchlistName: "  ", title: "", summary: " " })],
      }),
    );

    expect(paragraph).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["empty output", ""],
    ["whitespace output", "   \n  "],
    ["too-short output", "Competitors changed a few things."],
    ["too-long output", "Competitor movement continued across every watchlist. ".repeat(20)],
    ["bulleted output", "- Nykaa changed its offer\n- boAt launched new ads and pushed festival pricing hard this week"],
    ["numbered-list output", "1. Nykaa changed its landing page offer this week\n2. boAt launched two festival ads"],
    ["heading output", "## Weekly summary\nNykaa refreshed its discount while boAt introduced festival ads across the account."],
    ["bold-markdown output", `**Weekly summary** ${GOOD_PARAGRAPH}`],
    ["code-fence output", `\`\`\`\n${GOOD_PARAGRAPH}\n\`\`\``],
    ["newline-heavy output", "Nykaa refreshed its discount.\nboAt launched festival ads.\nMamaearth swapped creative.\nPlum stayed quiet this week."],
    ["prompt echo", "Restate only the provided change lines as 2 to 4 plain sentences describing what these competitors did this week without inventing claims."],
    ["assistant preamble echo", "As an AI, I summarize competitor ad and landing-page changes for a marketing team based on what you provided in the change lines."],
  ])("rejects %s", async (_label, output) => {
    const run = vi.fn().mockResolvedValue(output);
    await expect(
      buildWeeklyStrategyParagraph({ AI: { run } } as never, baseInput()),
    ).resolves.toBeNull();
  });

  it("rejects output that just echoes an input line back", async () => {
    const echoed =
      "Nykaa watch: Landing page offer changed — Offer changed on the landing page. That was the only logged movement across your watchlists this week.";
    const run = vi.fn().mockResolvedValue(echoed);
    await expect(
      buildWeeklyStrategyParagraph({ AI: { run } } as never, baseInput()),
    ).resolves.toBeNull();
  });
});

describe("buildStrategyInputLines", () => {
  it("ranks by priority score and caps the item count", () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      strategyItem({
        watchlistName: `Watch ${index}`,
        title: `Change ${index}`,
        metadata: { priorityScore: index * 10, sourceStatus: "proof_backed" },
      }),
    );

    const lines = buildStrategyInputLines(items);

    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain("Watch 9");
    expect(lines[5]).toContain("Watch 4");
  });

  it("caps the total prompt input length", () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      strategyItem({
        watchlistName: `Watch ${index}`,
        summary: "A very long change summary. ".repeat(30),
        metadata: { priorityScore: 90 - index, sourceStatus: "proof_backed" },
      }),
    );

    const lines = buildStrategyInputLines(items);
    const total = lines.reduce((sum, line) => sum + line.length, 0);

    expect(total).toBeLessThanOrEqual(1600);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(6);
  });
});

describe("validateStrategyParagraph", () => {
  it("collapses soft wraps into a single plain paragraph", () => {
    const wrapped = GOOD_PARAGRAPH.replace(". Most", ".\nMost");
    expect(validateStrategyParagraph(wrapped, [])).toBe(GOOD_PARAGRAPH);
  });

  it("rejects table-like output", () => {
    expect(
      validateStrategyParagraph(
        "Competitor | Change | Priority — Nykaa | offer swap | high — boAt | new ads | medium this week",
        [],
      ),
    ).toBeNull();
  });
});

describe("readDigestStrategyNote", () => {
  it("reads a stored paragraph and timestamp", () => {
    expect(
      readDigestStrategyNote({
        totalEvents: 3,
        strategyParagraph: `  ${GOOD_PARAGRAPH}  `,
        strategyGeneratedAt: "2026-07-13T05:00:00.000Z",
      }),
    ).toEqual({
      paragraph: GOOD_PARAGRAPH,
      generatedAt: "2026-07-13T05:00:00.000Z",
    });
  });

  it.each([
    ["missing summary", undefined],
    ["null summary", null],
    ["array summary", [1, 2] as unknown as Record<string, unknown>],
    ["legacy counts-only summary", { totalEvents: 3, watchlists: 2 }],
    ["non-string paragraph", { strategyParagraph: 42 }],
    ["blank paragraph", { strategyParagraph: "   " }],
  ])("returns null for %s", (_label, summary) => {
    expect(readDigestStrategyNote(summary as never)).toBeNull();
  });
});
