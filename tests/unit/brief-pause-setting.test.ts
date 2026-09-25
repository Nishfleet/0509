import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { BriefPauseSetting } from "../../app/components/brief-pause-setting";

function render(props: { pausedAt: string | null; timezone: string }): string {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(BriefPauseSetting, props),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("BriefPauseSetting", () => {
  it("shows the pause button and no paused line when the brief is running", () => {
    const html = render({ pausedAt: null, timezone: "Europe/London" });
    expect(html).toContain("Pause the brief");
    expect(html).toContain('value="pause"');
    expect(html).toContain('action="/app/settings/brief-pause"');
    expect(html).not.toContain("Paused since");
  });

  it("shows the resume button and the paused-since line when the brief is paused", () => {
    const html = render({ pausedAt: "2026-09-25T10:00:00.000Z", timezone: "Europe/London" });
    expect(html).toContain("Resume the brief");
    expect(html).toContain('value="resume"');
    expect(html).toContain("Paused since Friday 25 September.");
    expect(html).toMatch(/doesn.{1,6}t come/);
  });
});
