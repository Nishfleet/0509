import { describe, expect, it } from "vitest";

import { PROBE, expectNoHtmlInjection } from "../email-html-injection";
import { renderWelcome } from "../../workers/delivery/welcome-template";

const CTX = {
  rivals: ["Acme", "Globex"],
  rival_count: 5,
  first_brief_at: "2026-10-19T08:00:00.000Z",
  timezone: "UTC",
  home_link: "https://0509.io/app",
};

describe("welcome email", () => {
  it("names the rivals, how many more, and when the first brief lands", () => {
    const { subject, text } = renderWelcome(CTX);
    expect(subject).toBe("We're watching Acme, Globex and 3 more");
    expect(text).toContain("We're watching Acme, Globex and 3 more.");
    expect(text).toContain("weekly brief on Monday 19 October");
    expect(text).toContain("https://0509.io/app");
  });

  it("asks for rivals when none are watched and drops the date when it is unknown", () => {
    const { text } = renderWelcome({ ...CTX, rivals: [], rival_count: 0, first_brief_at: null });
    expect(text).toContain("Add the competitors you want to keep an eye on");
    expect(text).toContain("Your first ranking arrives with your weekly brief.");
  });

  it("falls back to a plain welcome when there are no rivals or the names are too long", () => {
    expect(renderWelcome({ ...CTX, rivals: [], rival_count: 0 }).subject).toBe("Welcome to Five to Nine");
    expect(renderWelcome({ ...CTX, rivals: ["x".repeat(50), "y".repeat(50)] }).subject).toBe("Welcome to Five to Nine");
  });

  it("promises nothing about timing", () => {
    const { text } = renderWelcome(CTX);
    expect(text).not.toMatch(/same day|right away|straight away|now\b/i);
  });

  it("previews the rivals line and keeps paragraphs apart in plain text", () => {
    const { html, text } = renderWelcome(CTX);
    expect(html).toContain("display:none");
    expect(html).toContain("We&#39;re watching Acme, Globex and 3 more.");
    expect(text).toContain("\n\nWe're watching");
  });

  it("links a label in the html and keeps the bare address for plain text", () => {
    const { html, text } = renderWelcome(CTX);
    expect(html).toContain('href="https://0509.io/app">Open your first look</a>');
    expect(html).not.toContain(">https://0509.io/app<");
    expect(text).toContain("Open your first look: https://0509.io/app");
  });

  it("escapes anything it is handed", () => {
    expectNoHtmlInjection(renderWelcome({ ...CTX, rivals: [PROBE] }).html, "rivals");
  });
});
