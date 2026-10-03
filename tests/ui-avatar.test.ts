import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar, AvatarFallback } from "../app/components/ui/avatar";

function render(props: { children?: ReactNode; className?: string; size?: "sm" | "lg" } = {}): string {
  return renderToStaticMarkup(createElement(Avatar, props));
}

describe("Avatar", () => {
  it("renders the avatar slot with the default size when no size is given", () => {
    const html = render();
    expect(html).toContain('data-slot="avatar"');
    expect(html).toContain('data-size="default"');
  });

  it("renders sm for size sm", () => {
    expect(render({ size: "sm" })).toContain('data-size="sm"');
  });

  it("renders lg for size lg", () => {
    expect(render({ size: "lg" })).toContain('data-size="lg"');
  });

  it("shows the fallback text when no image has loaded", () => {
    const html = render({ children: createElement(AvatarFallback, null, "AB") });
    expect(html).toContain("AB");
  });

  it("keeps a passed className next to the default rounded-full class", () => {
    const html = render({ className: "w-24" });
    expect(html).toContain("rounded-full");
    expect(html).toContain("w-24");
  });
});
