import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar, AvatarFallback } from "../app/components/ui/avatar";

type AvatarProps = ComponentProps<typeof Avatar>;

function render(props: AvatarProps = {}): string {
  return renderToStaticMarkup(createElement(Avatar, props));
}

function classNames(html: string): string[] {
  const match = /class="([^"]*)"/.exec(html);
  return match === null ? [] : match[1].split(" ");
}

describe("Avatar", () => {
  it("marks the root as the avatar slot and defaults its size", () => {
    const html = render();
    expect(html).toContain('data-slot="avatar"');
    expect(html).toContain('data-size="default"');
  });

  it("marks a small avatar with data-size sm", () => {
    expect(render({ size: "sm" })).toContain('data-size="sm"');
  });

  it("marks a large avatar with data-size lg", () => {
    expect(render({ size: "lg" })).toContain('data-size="lg"');
  });

  it("shows the fallback text when no image has loaded", () => {
    const html = render({ children: createElement(AvatarFallback, null, "AB") });
    expect(html).toContain('data-slot="avatar-fallback"');
    expect(html).toContain("AB");
  });

  it("keeps a passed className next to the default rounded-full", () => {
    const names = classNames(render({ className: "w-24" }));
    expect(names).toContain("rounded-full");
    expect(names).toContain("w-24");
  });

  it("lets a passed className win over a default class it collides with", () => {
    const names = classNames(render({ className: "rounded-lg" }));
    expect(names).toContain("rounded-lg");
    expect(names).not.toContain("rounded-full");
  });
});
