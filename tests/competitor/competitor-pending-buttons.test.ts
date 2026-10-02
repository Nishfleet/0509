import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import type { Navigation } from "react-router";
import type * as ReactRouterModule from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { CompetitorSite } from "../../app/components/competitor-site";
import { CompetitorYoutube } from "../../app/components/competitor-youtube";

// Both competitor forms post to the same route, so the pending state has to be
// scoped to the form that owns the in-flight intent. The harness stands in for
// the router's own navigation so each state is rendered for real.
const harness = vi.hoisted(() => ({
  state: "idle" as Navigation["state"],
  intent: null as string | null,
  formFor(intent: string | null): FormData | undefined {
    if (intent === null) return undefined;
    const data = new FormData();
    data.set("intent", intent);
    return data;
  },
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<ReactRouterModule>();
  return {
    ...actual,
    useNavigation: (): Navigation => ({
      state: harness.state,
      location: { pathname: "/app/competitors/ent-1", search: "", hash: "", state: null, key: "k" },
      matches: [],
      historyAction: "POP",
      formMethod: harness.state === "submitting" ? "post" : undefined,
      formAction: harness.state === "submitting" ? "/app/competitors/ent-1" : undefined,
      formEncType: undefined,
      formData: harness.formFor(harness.intent),
      json: undefined,
      text: undefined,
    }),
  };
});

function render(element: ReactElement): string {
  // Form needs a data router, so each form is rendered on its own route stub.
  const Stub = createRoutesStub([{ path: "/app/competitors/:entityId", Component: () => element }]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/app/competitors/ent-1"] }));
}

function openTag(html: string): string {
  const tag = html.match(/<button\b[^>]*>/);
  if (tag === null) throw new Error("no button in the rendered form");
  return tag[0];
}

function label(html: string): string {
  const block = html.match(/<button\b[^>]*>([\s\S]*?)<\/button>/);
  if (block === null || block[1] === undefined) throw new Error("no label in the rendered form");
  return block[1];
}

// The button's own class list carries `disabled:pointer-events-none`, so the
// attribute is matched on its own and not as a substring of the class string.
function isDisabled(tag: string): boolean {
  return /(?:^|\s)disabled(?:\s|>|=|$)/.test(tag);
}

const SITE = createElement(CompetitorSite, { url: null, error: null });
const YOUTUBE = createElement(CompetitorYoutube, { url: null, error: null });

describe("the competitor address forms report their own pending state", () => {
  beforeEach(() => {
    harness.state = "idle";
    harness.intent = null;
  });

  it("leaves both buttons live and on their own label while nothing is in flight", () => {
    harness.state = "idle";
    harness.intent = null;
    const site = render(SITE);
    const youtube = render(YOUTUBE);
    expect(isDisabled(openTag(site))).toBe(false);
    expect(isDisabled(openTag(youtube))).toBe(false);
    expect(label(site)).toBe("Watch this website");
    expect(label(youtube)).toBe("Save channel");
  });

  it("disables the website button and reads Checking… while the site form is submitting", () => {
    harness.state = "submitting";
    harness.intent = "site";
    expect(isDisabled(openTag(render(SITE)))).toBe(true);
    expect(label(render(SITE))).toBe("Checking…");
  });

  it("leaves the channel button alone while the site form is submitting", () => {
    harness.state = "submitting";
    harness.intent = "site";
    expect(isDisabled(openTag(render(YOUTUBE)))).toBe(false);
    expect(label(render(YOUTUBE))).toBe("Save channel");
  });

  it("disables the channel button and reads Checking… while the channel form is submitting", () => {
    harness.state = "submitting";
    harness.intent = "youtube";
    expect(isDisabled(openTag(render(YOUTUBE)))).toBe(true);
    expect(label(render(YOUTUBE))).toBe("Checking…");
  });

  it("leaves the website button alone while the channel form is submitting", () => {
    harness.state = "submitting";
    harness.intent = "youtube";
    expect(isDisabled(openTag(render(SITE)))).toBe(false);
    expect(label(render(SITE))).toBe("Watch this website");
  });

  it("leaves both buttons alone while an unrelated intent submits", () => {
    harness.state = "submitting";
    harness.intent = "add";
    expect(isDisabled(openTag(render(SITE)))).toBe(false);
    expect(label(render(SITE))).toBe("Watch this website");
    expect(isDisabled(openTag(render(YOUTUBE)))).toBe(false);
    expect(label(render(YOUTUBE))).toBe("Save channel");
  });

  it("keeps the site button disabled while the action and loader settle", () => {
    harness.state = "loading";
    harness.intent = "site";
    expect(isDisabled(openTag(render(SITE)))).toBe(true);
    expect(isDisabled(openTag(render(YOUTUBE)))).toBe(false);
  });

  it("leaves both buttons alone while a revalidation runs with no form in flight", () => {
    harness.state = "loading";
    harness.intent = null;
    expect(isDisabled(openTag(render(SITE)))).toBe(false);
    expect(isDisabled(openTag(render(YOUTUBE)))).toBe(false);
  });
});
