import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { BriefRow } from "../../app/components/settings-row";

const BASE_PROPS = {
  weekday: 1,
  hour: 8,
  timezone: "Europe/London",
  nextBrief: "Monday 5 October 2026, 08:00 Europe/London",
  error: null,
} as const;

function render(props: {
  weekday: number;
  hour: number;
  timezone: string;
  nextBrief: string;
  error: string | null;
}): string {
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
  });

  it("renders the validation error as an alert when the save fails", () => {
    const html = render({ ...BASE_PROPS, error: "Pick a day, an hour and a timezone from the lists." });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Pick a day, an hour and a timezone from the lists.");
  });
});
