import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactRouterModule from "react-router";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { BriefPauseSetting } from "../../app/components/brief-pause-setting";

// The submitting state lives only on a live fetcher, which a static render never
// holds, so this file swaps in a fetcher at the state the test names.
const fetcherState = vi.hoisted(() => ({ value: "idle" as "idle" | "submitting" | "loading" }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  const Form = ({ action, method, children }: { action: string; method: string; children: ReactNode }): ReactElement =>
    createElement("form", { action, method }, children);
  return { ...actual, useFetcher: () => ({ state: fetcherState.value, data: undefined, Form }) };
});

function render(props: { pausedAt: string | null; timezone: string }): string {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(BriefPauseSetting, props),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

function renderSetting(
  props: { pausedAt: string | null; timezone: string },
  state: "idle" | "submitting" | "loading",
): string {
  fetcherState.value = state;
  const html = render(props);
  fetcherState.value = "idle";
  return html;
}

// The opening tag only: the class list also holds the words "disabled:".
function buttonTag(html: string): string {
  const start = html.indexOf("<button ");
  return html.slice(start, html.indexOf(">", start));
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
    expect(html).toContain("no email is sent");
  });

  it("reads Paused since an unknown date when the stored instant is not a date", () => {
    const html = render({ pausedAt: "garbage", timezone: "Europe/London" });
    expect(html).toContain("Paused since an unknown date");
    expect(html).toContain("no email is sent");
    expect(html).not.toContain("Invalid");
  });

  it("disables the button and reads Saving while the request runs", () => {
    const html = renderSetting({ pausedAt: null, timezone: "Europe/London" }, "submitting");
    expect(html).toContain("Saving…");
    expect(html).not.toContain("Pause the brief");
    expect(buttonTag(html)).toContain('disabled=""');
  });

  it("keeps the resume label off the button while the request runs from a paused brief", () => {
    const html = renderSetting({ pausedAt: "2026-09-25T10:00:00.000Z", timezone: "Europe/London" }, "submitting");
    expect(html).toContain("Saving…");
    expect(html).not.toContain("Resume the brief");
    expect(buttonTag(html)).toContain('disabled=""');
  });

  it("leaves the button enabled at idle", () => {
    const html = renderSetting({ pausedAt: null, timezone: "Europe/London" }, "idle");
    expect(buttonTag(html)).not.toContain("disabled=");
  });
});
