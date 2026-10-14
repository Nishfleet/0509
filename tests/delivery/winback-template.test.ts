import { describe, expect, it } from "vitest";

import { PROBE, expectNoHtmlInjection } from "../email-html-injection";
import { renderWinback } from "../../workers/delivery/winback-template";

const CTX = {
  change_count: 3,
  latest: { rival: "Acme", what: "Homepage headline changed" },
  link: "https://0509.io/app/alerts",
  footer: { unsubscribe_url: "https://0509.io/u/tok", settings_link: "https://0509.io/app/settings" },
};

describe("win-back email", () => {
  it("counts the changes since the last visit and names the latest", () => {
    const { subject, text } = renderWinback(CTX);
    expect(subject).toBe("What your rivals did while you were away");
    expect(text).toContain("caught 3 changes");
    expect(text).toContain("Most recent: Acme, Homepage headline changed");
    expect(text).toContain("https://0509.io/app/alerts");
  });

  it("says change in the singular and skips the latest when there is none", () => {
    const { text } = renderWinback({ ...CTX, change_count: 1, latest: null });
    expect(text).toContain("caught 1 change across");
    expect(text).not.toContain("Most recent");
  });

  it("escapes anything it is handed", () => {
    expectNoHtmlInjection(renderWinback({ ...CTX, latest: { rival: PROBE, what: PROBE } }).html, "latest");
  });

  it("ends with an unsubscribe link", () => {
    const { html, text } = renderWinback(CTX);
    expect(html).toContain('href="https://0509.io/u/tok"');
    expect(text).toContain("Unsubscribe: https://0509.io/u/tok");
  });
});
