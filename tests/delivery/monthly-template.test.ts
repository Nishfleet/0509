import { describe, expect, it } from "vitest";

import { PROBE, expectNoHtmlInjection } from "../email-html-injection";
import { renderMonthly } from "../../workers/delivery/monthly-template";

const CTX = {
  month: "September",
  change_count: 4,
  moves: [
    { rival: "Acme", what: "Homepage headline changed" },
    { rival: "Beta", what: "New careers page" },
  ],
  link: "https://0509.io/app/alerts",
  footer: { unsubscribe_url: "https://0509.io/u/tok", settings_link: "https://0509.io/app/settings" },
};

describe("monthly note", () => {
  it("names the month, the count and the recent moves", () => {
    const { subject, text } = renderMonthly(CTX);
    expect(subject).toBe("Your month in rivals");
    expect(text).toContain("In September we caught 4 changes");
    expect(text).toContain("Acme, Homepage headline changed");
    expect(text).toContain("Beta, New careers page");
    expect(text).toContain("https://0509.io/app/alerts");
  });

  it("says change in the singular and leaves out the list when there are no moves", () => {
    const { text } = renderMonthly({ ...CTX, change_count: 1, moves: [] });
    expect(text).toContain("caught 1 change across");
    expect(text).not.toContain("Most recent");
  });

  it("escapes anything it is handed", () => {
    expectNoHtmlInjection(renderMonthly({ ...CTX, moves: [{ rival: PROBE, what: PROBE }] }).html, "moves");
  });
});
