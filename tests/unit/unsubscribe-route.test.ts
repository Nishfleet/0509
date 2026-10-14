import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub, NavigationType, UNSAFE_DataRouterNavigationContext, type Navigation } from "react-router";
import { describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ known: false, outcome: "invalid_token" as string }));

vi.mock("../../app/lib/data/email_suppression.server", () => ({
  isUnsubscribeTokenKnown: () => Promise.resolve(holder.known),
  isTeammateUnsubscribeToken: () => Promise.resolve(false),
  suppressByUnsubscribeToken: () => Promise.resolve(),
}));

vi.mock("../../app/lib/unsubscribe.server", () => ({
  unsubscribe: () => Promise.resolve(holder.outcome),
  unsubscribeScope: (value: unknown) => (value === "brief" || value === "alerts" ? value : "all"),
}));

import Unsubscribe, { ErrorBoundary, action, loader } from "../../app/routes/u.$token";

function postOf(token: string, url: string, body = new URLSearchParams("List-Unsubscribe=One-Click")) {
  const request = new Request(url, { method: "POST", body });
  return { params: { token }, request } as never;
}

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

function renderConfirm(unsubscribed: boolean, scope = "all"): string {
  const Stub = createRoutesStub([{ id: "routes/u.$token", path: "/u/:token", Component: Unsubscribe }]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: ["/u/t"],
      hydrationData: {
        loaderData: { "routes/u.$token": { link: "confirm", scope } },
        ...(unsubscribed ? { actionData: { "routes/u.$token": { unsubscribed: true, scope } } } : {}),
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
  if (state === "loading") {
    return {
      state,
      location: { pathname: "/u/t", search: "", hash: "", state: null, key: "k" },
      matches: [],
      historyAction: NavigationType.Pop,
      formMethod: undefined,
      formAction: undefined,
      formEncType: undefined,
      formData: undefined,
      json: undefined,
      text: undefined,
    };
  }
  return {
    state: "submitting",
    location: { pathname: "/u/t", search: "", hash: "", state: null, key: "k" },
    matches: [],
    historyAction: NavigationType.Pop,
    formMethod: "POST",
    formAction: "/u/t",
    formEncType: "application/x-www-form-urlencoded",
    formData: new FormData(),
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
          createElement(Unsubscribe, { actionData: undefined, loaderData: { link: "confirm", scope: "all" } } as never),
        ),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/u/t"] }));
}

function submitButton(html: string): string {
  const match = /<button[^>]*type="submit"[\s\S]*?<\/button>/.exec(html);
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

    const request = new Request("https://0509.io/u/t");
    const data = await loader({ params: { token: "a".repeat(64) }, request } as never);

    expect(data).toEqual({ link: "confirm", scope: "all" });
  });

  it("reads which email the link is for from its type", async () => {
    holder.known = true;
    const params = { token: "a".repeat(64) };

    const brief = await loader({ params, request: new Request("https://0509.io/u/t?type=brief") } as never);
    const alerts = await loader({ params, request: new Request("https://0509.io/u/t?type=alerts") } as never);
    const odd = await loader({ params, request: new Request("https://0509.io/u/t?type=nope") } as never);

    expect([brief, alerts, odd]).toEqual([
      { link: "confirm", scope: "brief" },
      { link: "confirm", scope: "alerts" },
      { link: "confirm", scope: "all" },
    ]);
  });

  it("answers a POST with a bogus token as a 404 instead of claiming success", async () => {
    holder.outcome = "invalid_token";

    expect(await statusOf(() => action(postOf("deadbeef", "https://0509.io/u/deadbeef")))).toBe(404);
  });

  it("answers a POST with a live token as success", async () => {
    holder.outcome = "unsubscribed";

    const data = await action(postOf("a".repeat(64), "https://0509.io/u/t?type=brief"));

<<<<<<< HEAD
    expect(data).toEqual({ unsubscribed: true, teammate: false });
=======
    expect(data).toEqual({ unsubscribed: true, scope: "brief" });
  });

  it("lets the second step widen a brief-only unsubscribe to everything", async () => {
    holder.outcome = "unsubscribed";
    const body = new URLSearchParams({ scope: "all" });

    const data = await action(postOf("a".repeat(64), "https://0509.io/u/t?type=brief", body));

    expect(data).toEqual({ unsubscribed: true, scope: "all" });
>>>>>>> 73f4c440c (Let people stop the brief or alerts on their own)
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

  it("names the one email a brief or alerts link stops, and offers everything as a second step", () => {
    const confirm = renderConfirm(false, "brief");
    expect(confirm).toContain("Stop the weekly brief?");
    expect(confirm).toContain("Alerts keep coming.");

    const done = renderConfirm(true, "alerts");
    expect(done).toContain("The weekly brief keeps coming.");
    expect(done).toContain("Stop everything instead");
    expect(done).toContain('name="scope"');

    expect(renderConfirm(true, "all")).not.toContain("Stop everything instead");
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

    const link = /<a\b[^>]*href="\/app\/settings"[^>]*>/.exec(html)?.[0] ?? "";

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
