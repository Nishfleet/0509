import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import Page from "../../app/routes/onboarding.competitors";

type Props = Parameters<typeof Page>[0];

describe("onboarding competitors page", () => {
  it("tells people a plan and a trial come next, before they press Start watching", () => {
    const props = {
      loaderData: { on: [], maybes: [], discovery: "done" },
      actionData: undefined,
    } as unknown as Props;
    const Stub = createRoutesStub([{ path: "/", Component: () => createElement(Page, props) }]);
    const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
    expect(html).toContain("Start watching");
    expect(html).toContain("Next you&#x27;ll choose a plan and start your 7-day trial.");
  });
});
