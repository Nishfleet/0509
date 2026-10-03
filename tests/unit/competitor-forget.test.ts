import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import type * as ReactRouterModule from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompetitorForget } from "../../app/components/competitor-forget";

const navigation = vi.hoisted(() => ({ state: "idle", intent: null as string | null }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<ReactRouterModule>();
  return {
    ...actual,
    useNavigation: () => {
      const formData = new FormData();
      if (navigation.intent !== null) formData.set("intent", navigation.intent);
      return { state: navigation.state, formData: navigation.intent === null ? undefined : formData };
    },
  };
});

function render(): string {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(CompetitorForget, { name: "Northwind", error: null }),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

function submitButton(html: string): string {
  return html.slice(html.lastIndexOf("<button"), html.indexOf("</button>"));
}

function isDisabled(button: string): boolean {
  return /<button\b[^>]*\sdisabled=""/.test(button);
}

function confirmInput(html: string): string {
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];
  const found = inputs.find((tag) => tag.includes('id="confirm-name"'));
  if (found === undefined) throw new Error("no confirm-name input in the rendered form");
  return found;
}

describe("CompetitorForget", () => {
  beforeEach(() => {
    navigation.state = "idle";
    navigation.intent = null;
  });

  it("keeps the idle label and styling", () => {
    const button = submitButton(render());
    expect(button).toContain("Remove and forget Northwind");
    expect(button).toContain("border-red");
    expect(button).toContain("text-ink");
    expect(button).not.toContain("Removing…");
    expect(isDisabled(button)).toBe(false);
  });

  it("disables its button and shows the working label while its own form is in flight", () => {
    navigation.state = "submitting";
    navigation.intent = "forget";
    const button = submitButton(render());
    expect(button).toContain("Removing…");
    expect(isDisabled(button)).toBe(true);
    expect(button).not.toContain("Remove and forget");
    expect(button).toContain("border-red");
  });

  it("stays idle while a different intent is in flight", () => {
    navigation.state = "submitting";
    navigation.intent = "add";
    const button = submitButton(render());
    expect(button).toContain("Remove and forget Northwind");
    expect(isDisabled(button)).toBe(false);
  });

  it("asks the keyboard not to autocorrect or spell-check the name you type", () => {
    const input = confirmInput(render());
    expect(input).toContain('autoCapitalize="none"');
    expect(input).toContain('autoCorrect="off"');
    expect(input).toContain('spellCheck="false"');
  });
});
