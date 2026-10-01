import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/lib/verify-delivery-address.server", () => ({
  confirmDeliveryAddress: () => Promise.resolve(),
}));

import VerifyAddress, { action, headers, meta } from "../../app/routes/v.$token";

function renderPage(confirmed: boolean): string {
  const Stub = createRoutesStub([{ id: "routes/v.$token", path: "/v/:token", Component: VerifyAddress }]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: ["/v/t"],
      hydrationData: confirmed ? { actionData: { "routes/v.$token": { confirmed: true } } } : {},
    }),
  );
}

describe("/v/:token (0509#5811)", () => {
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
