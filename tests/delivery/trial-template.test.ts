import { describe, expect, it } from "vitest";

import { PROBE, expectNoHtmlInjection } from "../email-html-injection";
import { renderTrialEnding } from "../../workers/delivery/trial-template";

const CTX = {
  plan: "Starter",
  monthly_price_eur: 46,
  ends_at: "2026-10-15T10:00:00.000Z",
  timezone: "UTC",
  link: "https://0509.io/app/settings",
};

describe("trial ending email", () => {
  it("names the end date, the plan, the price and where to cancel", () => {
    const { subject, text, html } = renderTrialEnding(CTX);
    expect(subject).toBe("Your Starter trial ends on Thursday 15 October");
    expect(text).toContain("charged €46 a month");
    expect(text).toContain("Cancel before then and you won't be charged");
    expect(text).toContain("https://0509.io/app/settings");
    expect(html).toContain("Manage or cancel your plan");
  });

  it("dates the end in the workspace's own zone", () => {
    const { subject } = renderTrialEnding({ ...CTX, ends_at: "2026-10-15T22:30:00.000Z", timezone: "Asia/Kolkata" });
    expect(subject).toBe("Your Starter trial ends on Friday 16 October");
  });

  it("escapes anything it is handed", () => {
    expectNoHtmlInjection(renderTrialEnding({ ...CTX, plan: PROBE }).html, "plan");
  });

  it("opens with a hidden inbox preview of the end date and the charge", () => {
    const { html } = renderTrialEnding(CTX);
    expect(html).toMatch(/display:none[^>]*>Your free trial of Starter ends on /);
  });
});
