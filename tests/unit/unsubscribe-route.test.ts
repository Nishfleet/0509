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

import Unsubscribe, { action, loader } from "../../app/routes/u.$token";

// `data()` returns a plain marker object rather than a Response, so the two
// accessors below read the status and body the route actually returned.
function bodyOf(value: unknown): unknown {
  if (value !== null && typeof value === "object" && "type" in value && "data" in value) {
    return (value as { data: unknown }).data;
  }
  return value;
}

function statusOf(value: unknown): number {
  if (value !== null && typeof value === "object" && "init" in value) {
    const init = (value as { init?: { status?: number } }).init;
    if (init?.status !== undefined) return init.status;
  }
  return 200;
}

function render(
  loaderData: { link: string },
  actionData?: { link: string; unsubscribed: boolean },
): string {
  const Stub = createRoutesStub([
    { id: "routes/u.$token", path: "/u/:token", Component: Unsubscribe },
  ]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: ["/u/t"],
      hydrationData: {
        loaderData: { "routes/u.$token": loaderData },
        ...(actionData === undefined ? {} : { actionData: { "routes/u.$token": actionData } }),
      },
    }),
  );
}

describe("/u/:token (0509#5761)", () => {
  it("serves the invalid-link page with a 404 for a token no target holds", async () => {
    holder.known = false;

    const response = await loader({ params: { token: "deadbeef" } } as never);

    expect(statusOf(response)).toBe(404);
    expect(bodyOf(response)).toEqual({ link: "invalid" });
  });

  it("serves the confirm form for a live token", async () => {
    holder.known = true;

    const response = await loader({ params: { token: "a".repeat(64) } } as never);

    expect(statusOf(response)).toBe(200);
    expect(bodyOf(response)).toEqual({ link: "confirm" });
  });

  it("answers a POST with a bogus token as a 404 instead of claiming success", async () => {
    holder.outcome = "invalid_token";

    const response = await action({ params: { token: "deadbeef" } } as never);

    expect(statusOf(response)).toBe(404);
    expect(bodyOf(response)).toEqual({ link: "invalid", unsubscribed: false });
  });

  it("answers a POST with a live token as success", async () => {
    holder.outcome = "unsubscribed";

    const response = await action({ params: { token: "a".repeat(64) } } as never);

    expect(statusOf(response)).toBe(200);
    expect(bodyOf(response)).toEqual({ link: "done", unsubscribed: true });
  });

  it("renders 'This link is not valid' rather than the confirm form when the loader says invalid", () => {
    const html = render({ link: "invalid" });

    expect(html).toContain("This link is not valid");
    expect(html).not.toContain("Stop the weekly brief?");
    expect(html).not.toContain("You&#x27;re unsubscribed");
  });

  it("renders the invalid-link page after a POST that found nothing to suppress", () => {
    const html = render({ link: "confirm" }, { link: "invalid", unsubscribed: false });

    expect(html).toContain("This link is not valid");
    expect(html).not.toContain("You&#x27;re unsubscribed");
  });

  it("renders the confirmation after a POST that suppressed the address", () => {
    const html = render({ link: "confirm" }, { link: "done", unsubscribed: true });

    expect(html).toContain("You&#x27;re unsubscribed");
    expect(html).not.toContain("This link is not valid");
  });

  it("renders the confirm form when the loader finds the token", () => {
    const html = render({ link: "confirm" });

    expect(html).toContain("Stop the weekly brief?");
    expect(html).not.toContain("This link is not valid");
  });
});
