import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import type { Navigation } from "react-router";
import type * as ReactRouterModule from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/verify-delivery-address.server", () => ({
  confirmDeliveryAddress: () => Promise.resolve(),
}));

import VerifyAddress, { action, headers, meta } from "../../app/routes/v.$token";

// The Confirm button must be disabled while the form's own submission runs, so
// the navigation mock carries the state the route's other forms only touch via
// their intents: the only post on this route is the confirm itself (the
// harness in tests/competitor/competitor-pending-buttons.test.ts drives the
// same pattern).
const harness = vi.hoisted(() => ({
  state: "idle" as Navigation["state"],
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<ReactRouterModule>();
  return {
    ...actual,
    useNavigation: (): Navigation => ({
      state: harness.state,
      location: { pathname: "/v/t", search: "", hash: "", state: null, key: "k" },
      matches: [],
      historyAction: "POP",
      formMethod: harness.state === "idle" ? undefined : "post",
      formAction: harness.state === "idle" ? undefined : "/v/t",
      formEncType: undefined,
      formData: new FormData(),
      json: undefined,
      text: undefined,
    }),
  };
});

function renderPage(confirmed: boolean): string {
  const Stub = createRoutesStub([{ id: "routes/v.$token", path: "/v/:token", Component: VerifyAddress }]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: ["/v/t"],
      hydrationData: confirmed ? { actionData: { "routes/v.$token": { confirmed: true } } } : {},
    }),
  );
}

function renderPending(state: Exclude<Navigation["state"], "idle">): string {
  harness.state = state;
  return renderPage(false);
}

describe("/v/:token (0509#5811)", () => {
  beforeEach(() => {
    harness.state = "idle";
  });

  it("opens the confirmation page for any token", () => {
    const html = renderPage(false);

    expect(html).toContain("Confirm this email address?");
    expect(html).toContain("Confirm email address");
    expect(html).not.toContain("Email address confirmed");
  });

  it("shows Email address confirmed after POST", () => {
    const html = renderPage(true);

    expect(html).toContain("Email address confirmed");
    expect(html).not.toContain("Confirm this email address?");
  });

  it("keeps the Confirm button disabled and reading Confirming… while the post is in flight", () => {
    const html = renderPending("submitting");
    expect(html).toContain("Confirm this email address?");
    expect(html).toContain("Confirming…");
    expect(/<button\b[^>]*\bdisabled\b[^>]*>/.exec(html)).not.toBeNull();
  });

  it("keeps the Confirm button disabled while the navigation settles after the post", () => {
    const html = renderPending("loading");
    expect(html).toContain("Confirming…");
    expect(/<button\b[^>]*\bdisabled\b[^>]*>/.exec(html)).not.toBeNull();
  });

  it("answers POST as confirmed for any token, including unknown", async () => {
    expect(await action({ params: { token: "deadbeef" } } as never)).toEqual({ confirmed: true });
    expect(await action({ params: { token: undefined } } as never)).toEqual({ confirmed: true });
  });

  it("is no-store and noindex", () => {
    expect(headers({} as never)).toEqual({ "Cache-Control": "no-store" });
    expect(meta({} as never)).toEqual([
      { title: "Confirm your email address · Five to Nine" },
      { name: "robots", content: "noindex, nofollow" },
    ]);
  });
});
