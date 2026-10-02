import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import type * as ReactRouterModule from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeleteAccount } from "../../app/components/account-settings";

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
      Component: () => createElement(DeleteAccount, { email: "a@b.co", error: null }),
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

describe("DeleteAccount", () => {
  beforeEach(() => {
    navigation.state = "idle";
    navigation.intent = null;
  });

  it("keeps the delete button's label in ink, not red", () => {
    const html = render();
    const button = html.slice(html.lastIndexOf("<button"), html.indexOf("Delete my account"));
    expect(button).toContain("text-ink");
    expect(button).not.toContain("text-red");
  });

  it("lists exactly what deletion removes, in order", () => {
    const html = render();
    const list = html.slice(
      html.indexOf('data-delete="removes"'),
      html.indexOf("</ul>", html.indexOf('data-delete="removes"')),
    );
    const items = [...list.matchAll(/<li>(.*?)<\/li>/g)].map((match) => match[1]);
    expect(items).toEqual([
      "Every brand you track, yours included",
      "Everything we found: site changes, ads, mentions and job listings",
      "Every saved copy of a website page",
      "Every screenshot",
      "Your shared ranking image",
      "Your send history and every brief",
      "Your account, its API keys and connected AI apps",
    ]);
    expect(html).toContain("The emails stop. This can&#x27;t be undone.");
  });

  it("keeps the idle label and styling", () => {
    const button = submitButton(render());
    expect(button).toContain("Delete my account");
    expect(button).toContain("border-red");
    expect(button).not.toContain("Deleting…");
    expect(isDisabled(button)).toBe(false);
  });

  it("disables its button and shows the working label while its own form is in flight", () => {
    navigation.state = "submitting";
    navigation.intent = "delete-account";
    const button = submitButton(render());
    expect(button).toContain("Deleting…");
    expect(isDisabled(button)).toBe(true);
    expect(button).not.toContain("Delete my account");
    expect(button).toContain("border-red");
  });

  it("stays idle while a different intent is in flight", () => {
    navigation.state = "submitting";
    navigation.intent = "sign-out";
    const button = submitButton(render());
    expect(button).toContain("Delete my account");
    expect(isDisabled(button)).toBe(false);
  });
});
