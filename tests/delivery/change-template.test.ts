import { describe, expect, it } from "vitest";

import { PROBE, expectNoHtmlInjection } from "../email-html-injection";
import { renderChange, renderChangeOverflow, type ChangeOverflowContext } from "../../workers/delivery/change-template";

const CTX = {
  headline: "Rival changed its pricing page",
  observed_at: "2026-10-01T02:10:00.000Z",
  mark: { removed: "Pro $12 a month", added: "Pro $15 a month" },
  link: "https://0509.io/app/alerts",
  timezone: "UTC",
  unsubscribe_url: "https://0509.io/u/opaque-token",
  settings_link: "https://0509.io/app/settings",
};

describe("rival change email", () => {
  it("subjects it as the headline and carries before, after and the link", () => {
    const { subject, text, html } = renderChange(CTX);
    expect(subject).toBe("Rival changed its pricing page");
    expect(text).toContain("Before: Pro $12 a month");
    expect(text).toContain("After: Pro $15 a month");
    expect(text).toContain("https://0509.io/app/alerts");
    expect(html).toContain("Pro $15 a month");
  });

  it("leaves out before and after when no mark could be read", () => {
    const { text } = renderChange({ ...CTX, mark: null });
    expect(text).not.toContain("Before:");
    expect(text).not.toContain("After:");
  });

  it("escapes what the rival's page said", () => {
    const { html } = renderChange({ ...CTX, mark: { removed: null, added: "<script>x</script>" } });
    expect(html).not.toContain("<script>x");
  });
});

describe("the alert footer (RFC 8058)", () => {
  it("links the alert settings and a one-click unsubscribe in text and html", () => {
    const { text, html } = renderChange(CTX);
    expect(text).toContain("Settings: https://0509.io/app/settings");
    expect(text).toContain("Unsubscribe: https://0509.io/u/opaque-token");
    expect(html).toContain('href="https://0509.io/app/settings"');
    expect(html).toContain('href="https://0509.io/u/opaque-token"');
  });
});

describe("the daily cap notice", () => {
  const OVERFLOW = {
    cap: 5,
    link: "https://0509.io/app/alerts",
    unsubscribe_url: CTX.unsubscribe_url,
    settings_link: CTX.settings_link,
  };

  it("says why the emails stopped and where every change still is", () => {
    const { subject, text } = renderChangeOverflow(OVERFLOW);
    expect(subject).toBe("More rivals changed price or plan today");
    expect(text).toContain("5 price or plan emails today");
    expect(text).toContain("Alerts and in your Monday brief");
    expect(text).toContain("Unsubscribe: https://0509.io/u/opaque-token");
  });
});

/**
 * 0509#7020: the change email escapes its sites by hand. This table plants the
 * injection probe in every string field, one row per field, so a missed
 * escapeHtml turns CI red — the plain template module stays.
 */
describe("every string field carries the injection probe escaped, never raw (0509#7020)", () => {
  const rows: Array<[string, Partial<typeof CTX>]> = [
    ["headline", { headline: PROBE }],
    ["observed_at", { observed_at: PROBE }],
    ["mark.removed", { mark: { removed: PROBE, added: "benign" } }],
    ["mark.added", { mark: { removed: "benign", added: PROBE } }],
    ["link", { link: PROBE }],
    ["timezone", { timezone: PROBE }],
    ["unsubscribe_url", { unsubscribe_url: PROBE }],
    ["settings_link", { settings_link: PROBE }],
  ];

  it.each(rows)("%s lands in the change email's html only escaped", (field, patch) => {
    const { html } = renderChange({ ...CTX, ...patch });
    expectNoHtmlInjection(html, `renderChange ${field}`);
  });

  const overflowRows: Array<[string, Partial<ChangeOverflowContext>]> = [
    ["link", { link: PROBE }],
    ["unsubscribe_url", { unsubscribe_url: PROBE }],
    ["settings_link", { settings_link: PROBE }],
  ];

  it.each(overflowRows)("%s lands in the cap notice's html only escaped", (field, patch) => {
    const { html } = renderChangeOverflow({
      cap: 5,
      link: "https://0509.io/app/alerts",
      unsubscribe_url: CTX.unsubscribe_url,
      settings_link: CTX.settings_link,
      ...patch,
    });
    expectNoHtmlInjection(html, `renderChangeOverflow ${field}`);
  });
});
