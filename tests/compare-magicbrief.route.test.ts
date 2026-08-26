import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useRouteLoaderData: () => undefined,
      useLoaderData: () => ({ featuredAdsLink: null }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderRouteMarkup() {
  const { default: CompareMagicBriefRoute } = await import("~/routes/compare.magicbrief");
  return renderToStaticMarkup(createElement(CompareMagicBriefRoute));
}

describe("compare magicbrief route", () => {
  it("renders migration copy without Slack GA claims", async () => {
    const markup = await renderRouteMarkup();

    expect(markup).toContain("Moving from MagicBrief?");
    expect(markup).toContain("Meta ads tracking is live on your competitors");
    expect(markup).not.toContain("labeled beta");
    expect(markup).toContain("Receipts for every move");
    expect(markup).not.toContain("Evidence over vibes");
    expect(markup).not.toContain("No screenshots, no claim");
    expect(markup).not.toContain("Slack delivery");
    expect(markup).not.toContain("WhatsApp delivery");
  });

  it("does not promise that collections, boards, or historical evidence transfer", async () => {
    const markup = await renderRouteMarkup();

    expect(markup).not.toContain("Bring your saved work");
    expect(markup).not.toContain("Saved ad library and boards");
    expect(markup).not.toContain("Collections — save winning ads");
    expect(markup).not.toContain("set up your collections");
  });

  it("states the supported import, the not-imported boundary, and the person-to-person fallback", async () => {
    const markup = await renderRouteMarkup();

    expect(markup).toContain("What imports.");
    expect(markup).toContain("imports as watchlists");
    expect(markup).toContain("Not imported");
    expect(markup).toContain("What does not transfer.");
    expect(markup).toContain("do not transfer through the generic import");
    expect(markup).toContain("are not imported");
    expect(markup).toContain("no full MagicBrief export contract is verified");
    expect(markup).toContain("person to person");
  });

  it("declares the canonical URL and honest page metadata", async () => {
    const { links, meta } = await import("~/routes/compare.magicbrief");

    expect(links()).toEqual([
      { rel: "canonical", href: "https://0509.io/compare/magicbrief" },
    ]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const description = tags.find((tag) => "name" in tag && tag.name === "description")?.content;

    expect(description).toContain("competitor list imports as watchlists");
    expect(description).toContain("collections, boards, and analytics history do not transfer");
    expect(description).not.toContain("migrate your collections");
    expect(description).not.toContain("Bring your saved work");
  });

  it("targets the search intent of displaced MagicBrief buyers in title and description", async () => {
    const { meta } = await import("~/routes/compare.magicbrief");

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    const description = tags.find((tag) => "name" in tag && tag.name === "description")?.content;

    expect(title).toContain("MagicBrief alternative");
    expect(description).toContain("MagicBrief alternative");
    expect(description).toBeDefined();
    expect(description!.length).toBeLessThanOrEqual(155);
  });

  it("answers the wind-down questions buyers search for, honestly", async () => {
    const markup = await renderRouteMarkup();

    expect(markup).toContain("MagicBrief wind-down questions, answered honestly.");
    expect(markup).toContain("What happened to MagicBrief?");
    expect(markup).toContain("closed on 31 July 2026");
    expect(markup).toContain("Is Five to Nine a MagicBrief alternative?");
    expect(markup).toContain("What actually moves from MagicBrief?");
    expect(markup).toContain("What does switching cost?");
    // The honest limits stay: no full migration promise in the FAQ answers.
    expect(markup).not.toContain("we move everything by hand");
  });

  it("emits one FAQPage JSON-LD block covering every visible FAQ entry", async () => {
    const markup = await renderRouteMarkup();

    const ldBlocks = [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const faqBlocks = ldBlocks
      .map((match) => JSON.parse(match[1]))
      .filter((data) => data["@type"] === "FAQPage");

    expect(faqBlocks).toHaveLength(1);
    const mainEntity = faqBlocks[0].mainEntity as Array<{ name: string }>;
    expect(mainEntity.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "What happened to MagicBrief?",
        "Is Five to Nine a MagicBrief alternative?",
        "What actually moves from MagicBrief?",
        "What does switching cost?",
      ]),
    );
  });

  it("keeps the public search CTA and support contact", async () => {
    const markup = await renderRouteMarkup();

    expect(markup).toContain('action="/search"');
    expect(markup).toContain("Try it free, no account");
    expect(markup).toContain("mailto:support@0509.io");
  });

  it("renders a primary migration CTA to signup with the capture source", async () => {
    const markup = await renderRouteMarkup();

    expect(markup).toContain("Start migration");
    expect(markup).toContain('href="/auth/signup?source=magicbrief-migration"');
    expect(markup).toContain("Import your competitor list now.");
    expect(markup).toContain("Sign up free — no card");
  });

  it("keeps the honest not-imported boundary next to the migration CTA", async () => {
    const markup = await renderRouteMarkup();

    expect(markup).toContain("Collections, boards, analytics history, and past");
    expect(markup).toContain("evidence are not migrated; you recreate them with our help");
    expect(markup).toContain("Start migration");
    expect(markup).not.toContain("we migrate everything");
  });

  it("does not overclaim manual migration and states the customer recreates non-imported data", async () => {
    const markup = await renderRouteMarkup();

    expect(markup).not.toContain("anything the import does not carry, we move by hand");
    expect(markup).not.toContain("we move by hand");
    expect(markup).toContain("are not migrated by Five to Nine");
    expect(markup).toContain("you recreate them with our help");
  });

  it("states client rooms are plan-gated in the import card", async () => {
    const markup = await renderRouteMarkup();

    expect(markup).toContain("client labels (client rooms on plans with client reporting)");
    expect(markup).not.toContain("client grouping");
  });
});
