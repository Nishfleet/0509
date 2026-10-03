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

function pill(props: { note?: string; highlight?: boolean } = {}): string {
  return renderToStaticMarkup(createElement("ul", null, createElement(Pill, { label: "Claude", ...props })));
}

function item(html: string): string {
  expect(html.match(/<li/g)).toHaveLength(1);
  return html.slice(html.indexOf("<li"), html.indexOf("</li>"));
}

describe("landing section", () => {
  it("names the section and ties the h2 to it, so a screen reader reads one heading with one label", () => {
    const html = section();
    expect(html).toContain('<section id="agents" aria-labelledby="agents-title"');
    expect(html).toContain("Built for your agents too.");
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1] ?? "";
    expect(labelledBy).toBe("agents-title");
    expect(html).toContain(`<h2 id="${labelledBy}"`);
  });

  it("renders the kicker as a small uppercase line above the display-face title", () => {
    const html = section();
    const kicker = html.slice(html.indexOf("<p"), html.indexOf("</p>") + 4);
    expect(kicker).toContain(">For AI agents</p>");
    expect(kicker).toContain("text-eyebrow");
    expect(kicker).toContain("uppercase");

    const title = html.slice(html.indexOf("<h2"), html.indexOf("</h2>"));
    expect(title).toContain("font-display");
    expect(title).toContain("uppercase");
    expect(title).toContain("Built for your agents too.");
  });

  it("renders the kicker and the children, and adds a lead paragraph only when a lead is given", () => {
    const bare = section();
    expect(bare.match(/<p/g)).toHaveLength(2);
    expect(bare).toContain(">For AI agents</p>");
    expect(bare).toContain("<p>child paragraph</p>");
    expect(bare).not.toContain("Your agent reads");

    const withLead = section({ lead: "Your agent reads the same ranking." });
    expect(withLead.match(/<p/g)).toHaveLength(3);
    expect(withLead).toContain('text-ink-soft">Your agent reads the same ranking.</p>');
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

  it("renders no note span when the note is omitted", () => {
    expect(pill()).not.toContain("<span");
    expect(pill({ note: undefined })).not.toContain("<span");
  });

  it("puts the note after a middle dot when a note is given", () => {
    expect(item(pill({ note: "News" }))).toContain('>Claude<span class="text-ink-soft"> · News</span>');
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
    const highlighted = item(pill({ note: "News", highlight: true }));
    expect(highlighted).toContain(" · News</span>");
    expect(highlighted).not.toContain("text-ink-soft");
  });
});
