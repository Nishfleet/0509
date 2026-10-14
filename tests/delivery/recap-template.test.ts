import { describe, expect, it } from "vitest";

import { PROBE, expectNoHtmlInjection } from "../email-html-injection";
import { renderRecap } from "../../workers/delivery/recap-template";

const CTX = {
  change_count: 3,
  latest: { rival: "Acme", what: "Homepage headline changed" },
  link: "https://0509.io/app/alerts",
};

describe("recap email", () => {
  it("counts the changes and names the latest", () => {
    const { subject, text } = renderRecap(CTX);
    expect(subject).toBe("What Five to Nine has caught so far");
    expect(text).toContain("caught 3 changes");
    expect(text).toContain("Most recent: Acme, Homepage headline changed");
    expect(text).toContain("https://0509.io/app/alerts");
  });

  it("says change in the singular and skips the latest when there is none", () => {
    const { text } = renderRecap({ ...CTX, change_count: 1, latest: null });
    expect(text).toContain("caught 1 change across");
    expect(text).not.toContain("Most recent");
  });

  it("escapes anything it is handed", () => {
    expectNoHtmlInjection(renderRecap({ ...CTX, latest: { rival: PROBE, what: PROBE } }).html, "latest");
  });
});
