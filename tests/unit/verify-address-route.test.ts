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

    expect(html).toContain("Confirm this address for your brief?");
    expect(html).toContain("Confirm address");
    expect(html).not.toContain("Address confirmed");
  });

  it("shows Address confirmed after POST", () => {
    const html = renderPage(true);

    expect(html).toContain("Address confirmed");
    expect(html).not.toContain("Confirm this address for your brief?");
  });

  it("answers POST as confirmed for any token, including unknown", async () => {
    expect(await action({ params: { token: "deadbeef" } } as never)).toEqual({ confirmed: true });
    expect(await action({ params: { token: undefined } } as never)).toEqual({ confirmed: true });
  });

  it("is no-store and noindex", () => {
    expect(headers({} as never)).toEqual({ "Cache-Control": "no-store" });
    expect(meta({} as never)).toEqual([
      { title: "Confirm your delivery email — Five to Nine" },
      { name: "robots", content: "noindex, nofollow" },
    ]);
  });
});
