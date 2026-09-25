import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReadThisFirst } from "../../app/components/read-this-first";
import type { BriefPayload } from "../../app/lib/brief-payload";

function mark(overrides: Partial<BriefPayload["read_this_first"][number]> = {}): BriefPayload["read_this_first"][number] {
  return {
    signal_id: "sig_1",
    entity_id: "ent_kindred",
    entity_name: "Kindred",
    title: "Pricing page rewritten",
    source: "site change",
    observed_at: "2026-09-16T15:30:00.000Z",
    thumbnail_r2_key: null,
    url: "https://kindred.example/pricing",
    before: "3 tiers",
    after: "2 tiers",
    jev_reason: "A competitor dropping a tier before launch week is the move.",
    ...overrides,
  };
}

describe("ReadThisFirst", () => {
  it("shows the empty line when the payload carries no marks", () => {
    const html = renderToStaticMarkup(createElement(ReadThisFirst, { marks: [] }));
    expect(html).toContain('data-brief-block="read-this-first"');
    expect(html).toContain("Read this first");
    expect(html).toContain("Nothing this week needed reading first.");
  });

  it("renders two marks in the order they are given", () => {
    const marks: BriefPayload["read_this_first"] = [
      mark({ signal_id: "sig_first", entity_name: "Kindred", jev_reason: "First reason." }),
      mark({
        signal_id: "sig_second",
        entity_id: "ent_casetta",
        entity_name: "Casetta",
        title: "New creative set",
        url: "https://facebook.example/ads/casetta",
        before: null,
        after: null,
        jev_reason: "Second reason.",
      }),
    ];
    const html = renderToStaticMarkup(createElement(ReadThisFirst, { marks }));
    const firstIdx = html.indexOf("First reason.");
    const secondIdx = html.indexOf("Second reason.");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(html).toContain("Kindred: First reason.");
    expect(html).toContain("Casetta: Second reason.");
  });

  it("renders only the curated fields, never a probability, a question id or the word Jev", () => {
    const leaky = {
      ...mark({ before: null, after: null, title: "New role open", jev_reason: "Hiring for a growth team." }),
      p: 0.85,
      question_id: "q-read-this-1",
      score: 7,
      picked_by: "Jev",
    };
    const html = renderToStaticMarkup(
      createElement(ReadThisFirst, { marks: [leaky] as BriefPayload["read_this_first"] }),
    );
    const text = html.replace(/<[^>]*>/g, " ");
    expect(text).not.toMatch(/0\.\d/);
    expect(text).not.toContain("q-read-this-1");
    expect(text).not.toContain("Jev");
    expect(text).not.toContain("probability");
    expect(text).toContain("New role open");
  });
});
