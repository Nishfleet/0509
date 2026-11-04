import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import Page from "../../app/routes/onboarding.plan";

type Props = Parameters<typeof Page>[0];

function render(loaderData: Partial<Props["loaderData"]>): string {
  const props = {
    loaderData: { tier: "scout", wanted: null, picked: null, checkoutPath: "/onboarding/plan", ...loaderData },
    actionData: undefined,
  } as unknown as Props;
  const Stub = createRoutesStub([{ path: "/", Component: () => createElement(Page, props) }]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("onboarding plan page", () => {
  it("offers the three plans to someone who has not paid", () => {
    const html = render({});
    expect(html).toContain("Start your trial");
    expect(html).toContain("Upgrade to Starter");
  });

  it("shows only the confirmation, no plan buttons, while the payment provider has not answered yet", () => {
    const html = render({ wanted: "starter", tier: "scout" });
    expect(html).toContain("Almost there");
    expect(html).toContain("Confirming your Starter plan");
    expect(html).not.toContain("Upgrade to");
  });
});
