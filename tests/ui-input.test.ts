import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Input } from "../app/components/ui/input";

function renderInput(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(Input, props));
}

function classOf(html: string): string {
  return /<input\b[^>]*\bclass="([^"]*)"/.exec(html)?.[1] ?? "";
}

describe("the Input component", () => {
  it("renders a single input with the data-slot and the min-h-12 base class", () => {
    const html = renderInput({ type: "text" });

    expect(html).toMatch(/^<input\b/);
    expect(html.match(/<input/g)?.length).toBe(1);
    expect(html).toContain('data-slot="input"');

    const css = classOf(html);
    expect(css).toContain("min-h-12");
    expect(css).toContain("w-full");
  });

  it("passes through passthrough props as attributes", () => {
    const html = renderInput({
      type: "email",
      name: "email",
      placeholder: "you@example.com",
      required: true,
      inputMode: "email",
    });

    expect(html).toContain('type="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain('placeholder="you@example.com"');
    expect(html).toContain("required");
    expect(html.toLowerCase()).toContain('inputmode="email"');
  });

  it("replaces the base w-full with a passed className via tailwind-merge", () => {
    const html = renderInput({ className: "w-32" });

    const css = classOf(html);
    expect(css).toContain("w-32");
    expect(css).not.toContain("w-full");
    expect(css).toContain("border-ink");
  });

  it("emits the disabled attribute when set", () => {
    const html = renderInput({ disabled: true });

    expect(html).toContain("disabled");
  });
});
