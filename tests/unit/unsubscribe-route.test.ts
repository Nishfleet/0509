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

function renderInvalid(): string {
  return renderToStaticMarkup(createElement(ErrorBoundary, {} as never));
}

function renderConfirm(unsubscribed: boolean): string {
  const Stub = createRoutesStub([
    { id: "routes/u.$token", path: "/u/:token", Component: Unsubscribe },
  ]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: ["/u/t"],
      hydrationData: {
        loaderData: { "routes/u.$token": { link: "confirm" } },
        ...(unsubscribed
          ? { actionData: { "routes/u.$token": { unsubscribed: true } } }
          : {}),
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
    const html = renderInvalid();

    expect(html).toContain("This link is not valid");
    expect(html).not.toContain("You&#x27;re unsubscribed");
    expect(html).not.toContain("Stop the weekly brief?");
  });

  it("renders the confirm form for a live token", () => {
    const html = renderConfirm(false);

    expect(html).toContain("Stop the weekly brief?");
    expect(html).not.toContain("This link is not valid");
  });

  it("renders the confirmation after a POST that suppressed the address", () => {
    const html = renderConfirm(true);

    expect(html).toContain("You&#x27;re unsubscribed");
    expect(html).not.toContain("This link is not valid");
  });
});
