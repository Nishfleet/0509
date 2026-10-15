import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import type { Navigation } from "react-router";
import type * as ReactRouterModule from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/verify-delivery-address.server", () => ({
  confirmDeliveryAddress: (token: string | undefined) => Promise.resolve(token === "good" || token === "mate"),
  readConfirmRole: (token: string | undefined) =>
    Promise.resolve(token === "mate" ? "teammate" : token === "good" ? "owner" : null),
}));

import VerifyAddress, { action, headers, loader, meta } from "../../app/routes/v.$token";

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

function renderPage(confirmed: boolean | "expired", teammate = false): string {
  const Stub = createRoutesStub([{ id: "routes/v.$token", path: "/v/:token", Component: VerifyAddress }]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: ["/v/t"],
      hydrationData: {
        loaderData: { "routes/v.$token": { teammate } },
        ...(confirmed === false
          ? {}
          : { actionData: { "routes/v.$token": { confirmed: confirmed === true, teammate } } }),
      },
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

  it("says the link has expired when no token matched, and never claims it confirmed", () => {
    const html = renderPage("expired");

    expect(html).toContain("This link has expired or was already used");
    expect(html).not.toContain("Email address confirmed");
    expect(html).not.toContain("Confirm this email address?");
  });

  it("answers POST with what the confirm actually did", async () => {
    expect(await action({ params: { token: "good" } } as never)).toEqual({ confirmed: true, teammate: false });
    expect(await action({ params: { token: "mate" } } as never)).toEqual({ confirmed: true, teammate: true });
    expect(await action({ params: { token: "deadbeef" } } as never)).toEqual({ confirmed: false, teammate: false });
    expect(await action({ params: { token: undefined } } as never)).toEqual({ confirmed: false, teammate: false });
  });

  it("tells a teammate the brief only, never alerts, and gives no way into the owner's app", () => {
    const before = renderPage(false, true);
    expect(before).toContain("The weekly brief will go to this email address");
    expect(before).not.toContain("alerts");

    const after = renderPage(true, true);
    expect(after).toContain("You are on the list");
    expect(after).not.toContain("alerts");
    expect(after).not.toContain('href="/app"');
    expect(after).not.toContain("Email address confirmed");
  });

  it("looks the role up for the page before the button is pressed", async () => {
    expect(await loader({ params: { token: "mate" } } as never)).toEqual({ teammate: true });
    expect(await loader({ params: { token: "good" } } as never)).toEqual({ teammate: false });
    expect(await loader({ params: { token: "nope" } } as never)).toEqual({ teammate: false });
  });

  it("is no-store and noindex", () => {
    expect(headers({} as never)).toEqual({ "Cache-Control": "no-store" });
    expect(meta({} as never)).toEqual([
      { title: "Confirm your email address · Five to Nine" },
      { name: "robots", content: "noindex, nofollow" },
    ]);
  });
});
