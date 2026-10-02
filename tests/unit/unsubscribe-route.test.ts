import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub, UNSAFE_DataRouterNavigationContext, type Navigation } from "react-router";
import { describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ known: false, outcome: "invalid_token" as string }));

vi.mock("../../app/lib/data/email_suppression.server", () => ({
  isUnsubscribeTokenKnown: () => Promise.resolve(holder.known),
  suppressByUnsubscribeToken: () => Promise.resolve(),
}));

vi.mock("../../app/lib/unsubscribe.server", () => ({
  unsubscribe: () => Promise.resolve(holder.outcome),
}));

import Unsubscribe, { ErrorBoundary, action, loader } from "../../app/routes/u.$token";

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  const outcome = await run().then(
    (value) => ({ ok: true as const, value }),
    (thrown: unknown) => ({ ok: false as const, thrown }),
  );
  if (outcome.ok) throw new Error(`expected a thrown 404, got ${JSON.stringify(outcome.value)}`);
  if (!(outcome.thrown instanceof Response)) {
    throw new Error(`expected a Response, got ${String(outcome.thrown)}`);
  }
  return outcome.thrown.status;
}

function renderBoundary(error: unknown): string {
  return renderToStaticMarkup(createElement(ErrorBoundary, { error } as never));
}

function renderConfirm(unsubscribed: boolean): string {
  const Stub = createRoutesStub([{ id: "routes/u.$token", path: "/u/:token", Component: Unsubscribe }]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: ["/u/t"],
      hydrationData: {
        loaderData: { "routes/u.$token": { link: "confirm" } },
        ...(unsubscribed ? { actionData: { "routes/u.$token": { unsubscribed: true } } } : {}),
      },
    }),
  );
}

function navigationAt(state: Navigation["state"]): Navigation {
  if (state === "idle") {
    return {
      state,
      location: undefined,
      matches: undefined,
      historyAction: undefined,
      formMethod: undefined,
      formAction: undefined,
      formEncType: undefined,
      formData: undefined,
      json: undefined,
      text: undefined,
    };
  }
  return {
    state,
    location: { pathname: "/u/t", search: "", hash: "", state: null, key: "k" },
    matches: [],
    historyAction: "POP",
    formMethod: state === "submitting" ? "post" : undefined,
    formAction: state === "submitting" ? "/u/t" : undefined,
    formEncType: state === "submitting" ? "application/x-www-form-urlencoded" : undefined,
    formData: state === "submitting" ? new FormData() : undefined,
    json: undefined,
    text: undefined,
  };
}

function renderFormAt(state: Navigation["state"]): string {
  const Stub = createRoutesStub([
    {
      id: "routes/u.$token",
      path: "/u/:token",
      Component: () =>
        createElement(
          UNSAFE_DataRouterNavigationContext.Provider,
          { value: { navigation: navigationAt(state), revalidation: "idle" } },
          createElement(Unsubscribe, { actionData: undefined } as never),
        ),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/u/t"] }));
}

function submitButton(html: string): string {
  const match = html.match(/<button[^>]*type="submit"[\s\S]*?<\/button>/);
  if (match === null) throw new Error(`no submit button in ${html}`);
  return match[0];
}

describe("/u/:token (0509#5761)", () => {
  it("serves a 404 for a token no target holds", async () => {
    holder.known = false;

    expect(await statusOf(() => loader({ params: { token: "deadbeef" } } as never))).toBe(404);
  });

  it("serves the confirm page for a live token", async () => {
    holder.known = true;

    const data = await loader({ params: { token: "a".repeat(64) } } as never);

    expect(data).toEqual({ link: "confirm" });
  });

  it("answers a POST with a bogus token as a 404 instead of claiming success", async () => {
    holder.outcome = "invalid_token";

    expect(await statusOf(() => action({ params: { token: "deadbeef" } } as never))).toBe(404);
  });

  it("answers a POST with a live token as success", async () => {
    holder.outcome = "unsubscribed";

    const data = await action({ params: { token: "a".repeat(64) } } as never);

    expect(data).toEqual({ unsubscribed: true });
  });

  it("renders 'This link is not valid' with no unsubscribe claim in it", () => {
    const html = renderBoundary({ status: 404, statusText: "Not Found", internal: true, data: "" });

    expect(html).toContain("This link is not valid");
    expect(html).not.toContain("You&#x27;re unsubscribed");
    expect(html).not.toContain("Unsubscribe from Five to Nine emails?");
  });

  it("renders the generic problem page for a failure that is not a 404", () => {
    for (const error of [
      new Error("D1 unavailable"),
      { status: 500, statusText: "Internal Server Error", internal: true, data: "" },
    ]) {
      const html = renderBoundary(error);

      expect(html).toContain("Something went wrong");
      expect(html).not.toContain("This link is not valid");
    }
  });

  it("renders the confirm form for a live token", () => {
    const html = renderConfirm(false);

    expect(html).toContain("Unsubscribe from Five to Nine emails?");
    expect(html).not.toContain("This link is not valid");
  });

  it("renders the confirmation after a POST that suppressed the address", () => {
    const html = renderConfirm(true);

    expect(html).toContain("You&#x27;re unsubscribed");
    expect(html).toContain("Changed your mind?");
    expect(html).toContain('href="/app/settings"');
    expect(html).not.toContain("No more email");
    expect(html).not.toContain("This link is not valid");
  });

  // DESIGN.md: tap targets are 44px minimum. min-h-11 is 44px in this repo
  // (tests/unit/onboarding-competitors.test.ts); inline-flex and items-center
  // are what make the line box reach that height.
  it("gives the Settings link a 44px-tall tap target", () => {
    const html = renderConfirm(true);

    const link = html.match(/<a\b[^>]*href="\/app\/settings"[^>]*>/)?.[0] ?? "";

    expect(link).toContain("min-h-11");
    expect(link).toContain("inline-flex");
    expect(link).toContain("items-center");
  });

  describe("the Unsubscribe button reports its pending state (0509#6641)", () => {
    it("is enabled and reads Unsubscribe while nothing is in flight", () => {
      const html = submitButton(renderFormAt("idle"));
      expect(html).toContain(">Unsubscribe<");
      expect(html).not.toContain('disabled=""');
      expect(html).not.toContain("Unsubscribing…");
    });

    it("is disabled and reads Unsubscribing… while the POST is submitting", () => {
      const html = submitButton(renderFormAt("submitting"));
      expect(html).toContain('disabled=""');
      expect(html).toContain("Unsubscribing…");
      expect(html).not.toContain(">Unsubscribe<");
    });

    it("stays disabled while the action and loader settle after submitting", () => {
      const html = submitButton(renderFormAt("loading"));
      expect(html).toContain('disabled=""');
      expect(html).toContain("Unsubscribing…");
    });
  });
});
