import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Pill } from "../../app/components/landing/pill";
import { Section } from "../../app/components/landing/section";

const SECTION_PROPS = { id: "agents", kicker: "For AI agents", title: "Built for your agents too." };

function section(overrides: { lead?: string } = {}): string {
  return renderToStaticMarkup(
    createElement(Section, { ...SECTION_PROPS, ...overrides }, createElement("p", null, "child paragraph")),
  );
}

function pill(props: { label?: string; note?: string; highlight?: boolean } = {}): string {
  return renderToStaticMarkup(createElement("ul", null, createElement(Pill, { label: "Claude", ...props })));
}

function item(html: string): string {
  return html.slice(html.indexOf("<li"), html.indexOf("</li>"));
}

describe("landing section", () => {
  it("names the section and ties the h2 to it, so a screen reader reads one heading with one label", () => {
    const html = section();
    expect(html).toContain('<section id="agents" aria-labelledby="agents-title"');
    expect(html).toContain('<h2 id="agents-title"');
    expect(html).toContain("Built for your agents too.");
  });

  it("renders the kicker as the small uppercase line above the title", () => {
    const html = section();
    expect(html).toContain('<p class="font-mono text-eyebrow font-medium uppercase text-ink-soft">For AI agents</p>');
    expect(html).toContain("font-display");
    expect(html).toContain("uppercase");
  });

  it("adds the lead paragraph only when a lead is given", () => {
    const bare = section();
    expect(bare).not.toContain("mt-5");
    expect(bare.match(/<p/g)).toHaveLength(2);

    const withLead = section({ lead: "Your agent reads the same ranking." });
    expect(withLead.match(/<p/g)).toHaveLength(3);
    expect(withLead).toContain(
      '<p class="mt-5 max-w-[42rem] text-[1.05rem] leading-[1.6] text-ink-soft">Your agent reads the same ranking.</p>',
    );
  });

  it("puts the children inside the section, below the headings", () => {
    const html = section();
    const body = html.slice(html.indexOf("<section"), html.indexOf("</section>"));
    expect(body).toContain("<p>child paragraph</p>");
    expect(html.indexOf("<p>child paragraph</p>")).toBeGreaterThan(html.indexOf('id="agents-title"'));
  });
});

describe("landing pill", () => {
  it("is one list item that carries the label and nothing else when there is no note", () => {
    const html = pill();
    expect(html).toContain("<li");
    expect(html).toContain(">Claude</li>");
    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html).not.toContain("<span");
  });

  it("puts the note after a middle dot when a note is given, and never when it is not", () => {
    expect(pill({ note: "News" })).toContain('>Claude<span class="text-ink-soft"> · News</span></li>');
    expect(pill({ note: "" })).toContain('>Claude<span class="text-ink-soft"> · </span></li>');
    expect(pill({ note: undefined })).not.toContain("<span");
  });

  it("wears the green wash when highlighted and the plain card when not", () => {
    const plain = item(pill());
    expect(plain).toContain("border-line");
    expect(plain).toContain("bg-card");
    expect(plain).toContain("text-ink");
    expect(plain).not.toContain("bg-green-wash");
    expect(plain).not.toContain("border-green-ink");
    expect(plain).not.toContain("text-green-ink");

    const highlighted = item(pill({ highlight: true }));
    expect(highlighted).toContain("bg-green-wash");
    expect(highlighted).toContain("border-green-ink");
    expect(highlighted).toContain("text-green-ink");
    expect(highlighted).not.toContain("bg-card");
    expect(highlighted).not.toContain("border-line");
    expect(highlighted).not.toContain("text-ink");
  });

  it("keeps the note span soft only while the pill is not highlighted", () => {
    expect(item(pill({ note: "News" }))).toContain('<span class="text-ink-soft"> · News</span>');
    expect(item(pill({ note: "News", highlight: true }))).toContain('<span class=""> · News</span>');
    expect(item(pill({ note: "News", highlight: true }))).not.toContain("text-ink-soft");
  });
});
