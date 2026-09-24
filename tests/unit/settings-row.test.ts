import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { BriefRow, type BriefRowProps } from "../../app/components/settings-row";

const ACTION_ERROR = "Pick a day, an hour and a timezone from the lists.";

const BASE_PROPS: BriefRowProps = {
  weekday: 1,
  hour: 8,
  timezone: "Europe/London",
  nextBrief: "Monday 5 October 2026, 08:00 Europe/London",
  timezones: ["UTC", "Europe/London"],
  error: null,
};

function render(props: BriefRowProps): string {
  const Stub = createRoutesStub([
    { path: "/app/settings", Component: () => createElement(BriefRow, props) },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/app/settings"] }));
}

describe("settings-row: BriefRow", () => {
  it("shows day, hour, time zone and the next brief, and no <label>", () => {
    const html = render(BASE_PROPS);

    expect(html).toContain("Monday at 08:00, Europe/London");
    expect(html).toContain("Next brief: Monday 5 October 2026, 08:00 Europe/London");
    expect(html).toContain("Change");
    expect(html).not.toMatch(/<label[^>]*>/);
    expect(html).not.toMatch(/<select[^>]*>/);
  });

  it("edits in place with three selects, the hidden intent and one Save", () => {
    const html = render({ ...BASE_PROPS, error: ACTION_ERROR });

    expect(html).toMatch(/<form[^>]*action="\/app\/settings"[^>]*method="post"/);
    expect(html).toContain('name="intent" value="brief-schedule"');
    expect(html).toContain('name="weekday"');
    expect(html).toContain('aria-label="Brief day"');
    expect(html).toContain('name="hour"');
    expect(html).toContain('aria-label="Brief hour"');
    expect(html).toContain('name="timezone"');
    expect(html).toContain('aria-label="Timezone"');
    expect(html.match(/<select/g)).toHaveLength(3);
    expect(html).not.toMatch(/<label[^>]*>/);
    expect(html).toMatch(/<button[^>]*type="submit"/);
    expect(html).toContain("Save");
    expect(html).not.toContain("Change");
  });

  it("preselects the saved day, hour and zone in the edit state", () => {
    const html = render({ ...BASE_PROPS, error: ACTION_ERROR });

    expect(html).toMatch(/<option[^>]*value="1" selected="">Monday<\/option>/);
    expect(html).toMatch(/<option[^>]*value="8" selected="">08:00<\/option>/);
    expect(html).toMatch(/<option[^>]*value="Europe\/London" selected="">Europe\/London<\/option>/);
  });

  it("renders the validation error as an alert with the string the action returns", () => {
    const html = render({ ...BASE_PROPS, error: ACTION_ERROR });

    expect(html).toContain('id="brief-row-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(ACTION_ERROR);
  });
});
