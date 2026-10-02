import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
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
});
