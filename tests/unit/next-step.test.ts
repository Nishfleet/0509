import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReadThisFirst } from "../../app/components/read-this-first";
import { nextStepLine } from "../../app/lib/next-step";

describe("next step line", () => {
  it("has a fixed calm line for each kind that calls for one", () => {
    for (const kind of ["pricing", "offer", "launch", "removal", "copy", "breakage", "unintended"]) {
      expect(nextStepLine(kind)).toMatch(/\.$/);
    }
  });

  it("says nothing for noise, an unknown kind or no kind", () => {
    expect(nextStepLine("noise")).toBeNull();
    expect(nextStepLine("mystery")).toBeNull();
    expect(nextStepLine(null)).toBeNull();
    expect(nextStepLine(undefined)).toBeNull();
  });

  it("never guesses at why the rival did it", () => {
    for (const kind of ["pricing", "offer", "launch", "removal", "copy", "breakage", "unintended"]) {
      expect(nextStepLine(kind)).not.toMatch(/because|probably wants|trying to|in order to/i);
    }
  });
});

describe("read this first on the web", () => {
  const mark = {
    signal_id: "s1",
    entity_id: "e1",
    entity_name: "Acme",
    title: "Pricing page changed",
    source: "Website",
    observed_at: "2026-10-14T00:00:00Z",
    thumbnail_r2_key: null,
    url: "https://acme.com/pricing",
    before: null,
    after: null,
    jev_reason: "A price moved.",
  };

  it("shows the next step under a mark with a kind and none without", () => {
    const withKind = renderToStaticMarkup(createElement(ReadThisFirst, { marks: [{ ...mark, kind: "pricing" }] }));
    expect(withKind).toContain("Compare it with your own pricing.");
    expect(renderToStaticMarkup(createElement(ReadThisFirst, { marks: [mark] }))).not.toContain("Compare it with");
  });
});
