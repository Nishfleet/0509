import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { DeliveryAddress } from "../../app/components/delivery-address";

function render(props: { address: string; error: string | null; suppressed: boolean }): string {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(DeliveryAddress, props),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("DeliveryAddress", () => {
  it("shows the address and the intent with no resume or alert when there is nothing wrong", () => {
    const html = render({ address: "me@brand.com", error: null, suppressed: false });
    expect(html).toContain('name="address"');
    expect(html).toContain('value="me@brand.com"');
    expect(html).toContain('name="intent"');
    expect(html).toContain('value="delivery-address"');
    expect(html).not.toContain('name="resume"');
    expect(html).not.toContain('role="alert"');
  });

  it("offers resume and the alert when the address is suppressed", () => {
    const html = render({
      address: "me@brand.com",
      error: "This address unsubscribed from the brief.",
      suppressed: true,
    });
    expect(html).toContain('name="resume"');
    expect(html).toContain("Send to it again");
    expect(html).toContain('role="alert"');
    expect(html).toContain("This address unsubscribed from the brief.");
  });
});
