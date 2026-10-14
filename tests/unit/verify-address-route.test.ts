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

const harness = vi.hoisted(() => ({
  state: "idle" as Navigation["state"],
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,

    useNavigation: (...args: Parameters<typeof actual.useNavigation>) =>
      harness.state === "idle" ? actual.useNavigation(...args) : { state: harness.state },
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

function expectDisabledButton(html: string): void {
  const disabledButton = /<button\b[^>]*\bdisabled\b[^>]*>/.exec(html);
  expect(disabledButton).not.toBeNull();

  const fromButton = disabledButton && html.slice(disabledButton.index);
  expect(fromButton).toMatch(/Confirm/);
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

  it("links on to the app after POST, so the page is not a dead end (0509#6762)", () => {
    const html = renderPage(true);

    expect(html).toMatch(/<a\b[^>]*href="\/app"/);
    expect(html).toContain("Open Five to Nine");
    expect(renderPage(false)).not.toContain('href="/app"');
  });

  it("keeps the Confirm button disabled and reading Confirming… while the post is in flight", () => {
    const html = renderPending("submitting");
    expect(html).toContain("Confirm this email address?");
    expect(html).toContain("Confirming…");
    expectDisabledButton(html);
  });

  it("keeps the Confirm button disabled while the navigation settles after the post", () => {
    const html = renderPending("loading");
    expect(html).toContain("Confirming…");
    expectDisabledButton(html);
  });

  it("keeps the Confirm button disabled while a revalidation runs with no form in flight", () => {
    const html = renderPending("loading");
    expect(html).toContain("Confirming…");
    expectDisabledButton(html);
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
