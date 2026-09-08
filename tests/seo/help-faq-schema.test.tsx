import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function parseLdJsonBlocks(markup: string): Array<Record<string, unknown>> {
  const matches = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return matches.map((match) => JSON.parse(match[1]) as Record<string, unknown>);
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useRouteLoaderData: vi.fn().mockReturnValue(undefined),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

// The six H2 sections on /help, verbatim. The FAQPage must carry exactly one
// Question per existing H2 — no omissions, no fabricated Q/A.
const EXPECTED_QUESTIONS = [
  "Start here",
  "Delivery setup",
  "Billing help",
  "Cancellation and deletion",
  "Paid customer support paths",
  "Contact support",
];

describe("/help FAQPage JSON-LD", () => {
  it("emits one FAQPage block with one Question per H2 section", async () => {
    const { default: HelpRoute } = await import("~/routes/help");
    const markup = renderToStaticMarkup(createElement(HelpRoute));

    const faqBlocks = parseLdJsonBlocks(markup).filter((block) => block["@type"] === "FAQPage");
    expect(faqBlocks, "/help is missing a FAQPage block").toHaveLength(1);

    const faq = faqBlocks[0] as { mainEntity?: Array<Record<string, unknown>> };
    const questions = faq.mainEntity ?? [];
    expect(questions.length).toBe(EXPECTED_QUESTIONS.length);

    const names = questions.map((q) => q.name);
    for (const expected of EXPECTED_QUESTIONS) {
      expect(names).toContain(expected);
    }

    for (const question of questions) {
      expect(question["@type"]).toBe("Question");
      expect(typeof question.name).toBe("string");
      expect(String(question.name).length).toBeGreaterThan(0);
      const acceptedAnswer = question.acceptedAnswer as Record<string, unknown> | undefined;
      expect(acceptedAnswer, "Question is missing acceptedAnswer").toBeDefined();
      expect(acceptedAnswer?.["@type"]).toBe("Answer");
      expect(typeof acceptedAnswer?.text).toBe("string");
      expect(String(acceptedAnswer?.text).length).toBeGreaterThan(0);
    }
  });

  it("keeps the existing WebPage JSON-LD block unchanged", async () => {
    const { default: HelpRoute } = await import("~/routes/help");
    const markup = renderToStaticMarkup(createElement(HelpRoute));

    const webPages = parseLdJsonBlocks(markup).filter((block) => block["@type"] === "WebPage");
    expect(webPages).toHaveLength(1);
    expect(webPages[0].name).toBe("Help | Five to Nine");
    expect(webPages[0].url).toMatch(/^https:\/\/0509\.io/);
  });
});
