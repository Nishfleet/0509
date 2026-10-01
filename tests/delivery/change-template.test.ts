import { describe, expect, it } from "vitest";

import { renderChange } from "../../workers/delivery/change-template";

const CTX = {
  headline: "Rival changed its pricing page",
  observed_at: "2026-10-01T02:10:00.000Z",
  mark: { removed: "Pro $12 a month", added: "Pro $15 a month" },
  link: "https://0509.io/app/alerts",
  timezone: "UTC",
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
