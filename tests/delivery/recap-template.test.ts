import { describe, expect, it } from "vitest";

import { PROBE, expectNoHtmlInjection } from "../email-html-injection";
import { renderRecap } from "../../workers/delivery/recap-template";

const CTX = {
  change_count: 3,
  latest: { rival: "Acme", what: "Homepage headline changed" },
  link: "https://0509.io/app/alerts",
  standing: [],
  footer: { unsubscribe_url: "https://0509.io/u/tok", settings_link: "https://0509.io/app/settings" },
};

describe("recap email", () => {
  it("counts the changes and names the latest", () => {
    const { subject, text } = renderRecap(CTX);
    expect(subject).toBe("3 competitor changes caught so far, latest: Acme");
    expect(text).toContain("caught 3 changes");
    expect(text).toContain("Most recent: Acme, Homepage headline changed");
    expect(text).toContain("https://0509.io/app/alerts");
  });

  it("keeps the subject short and drops the rival name when it is long", () => {
    const long = renderRecap({ ...CTX, latest: { rival: "x".repeat(80), what: "y" } }).subject;
    expect(long).toBe("3 competitor changes caught so far");
    expect(renderRecap({ ...CTX, change_count: 1, latest: null }).subject).toBe("1 competitor change caught so far");
  });

  it("says change in the singular and skips the latest when there is none", () => {
    const { text } = renderRecap({ ...CTX, change_count: 1, latest: null });
    expect(text).toContain("caught 1 change across");
    expect(text).not.toContain("Most recent");
  });

  it("leads the inbox preview with the latest move, or the count when there is none", () => {
    expect(renderRecap(CTX).html).toMatch(/display:none[^>]*>Most recent: Acme, Homepage headline changed/);
    expect(renderRecap({ ...CTX, latest: null }).html).toMatch(
      /display:none[^>]*>In your first days we(?:'|&#39;)ve caught 3 changes across your competitors\./,
    );
  });

  it("offers one labelled link and no real-time promise", () => {
    const { html, text } = renderRecap(CTX);
    expect(html).toContain('href="https://0509.io/app/alerts">See everything in Alerts</a>');
    expect(text).not.toMatch(/instantly|right away|real.?time|as it happens/i);
  });

  it("ends with an unsubscribe link", () => {
    const { html, text } = renderRecap(CTX);
    expect(html).toContain('href="https://0509.io/u/tok"');
    expect(text).toContain("Unsubscribe: https://0509.io/u/tok");
  });

  it("shows where rivals stand when nothing has changed", () => {
    const { subject, text } = renderRecap({
      ...CTX,
      change_count: 0,
      latest: null,
      standing: [{ rival: "Acme", lines: ["In its own words: Invoices for freelancers"] }],
    });
    expect(text).toContain("Nothing has changed on their sites yet.");
    expect(text).toContain("Acme\nIn its own words: Invoices for freelancers");
    expect(text).not.toContain("caught");
    expect(subject).toBe("Where your competitors stand today");
  });

  it("escapes anything it is handed", () => {
    expectNoHtmlInjection(renderRecap({ ...CTX, latest: { rival: PROBE, what: PROBE } }).html, "latest");
  });
});
