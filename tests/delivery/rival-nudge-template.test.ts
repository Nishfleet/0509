import { describe, expect, it } from "vitest";

import { PROBE, expectNoHtmlInjection } from "../email-html-injection";
import { renderRivalNudge } from "../../workers/delivery/rival-nudge-template";

const CTX = {
  rivals: 1,
  rival_name: "Acme",
  link: "https://0509.io/app/competitors",
  footer: { unsubscribe_url: "https://0509.io/u/tok", settings_link: "https://0509.io/app/settings" },
};

describe("add-a-rival email", () => {
  it("names the one rival, offers one labelled link and an unsubscribe", () => {
    const { subject, html, text } = renderRivalNudge(CTX);
    expect(subject).toBe("Your brief compares you with one rival so far");
    expect(text).toContain("You are watching Acme");
    expect(html).toContain('href="https://0509.io/app/competitors">Add a rival</a>');
    expect(html.match(/href="https:\/\/0509\.io\/app\/competitors"/g)).toHaveLength(1);
    expect(html).toContain('href="https://0509.io/u/tok"');
    expect(text).toContain("Unsubscribe: https://0509.io/u/tok");
  });

  it("asks for a first rival when there are none", () => {
    const { subject, text } = renderRivalNudge({ ...CTX, rivals: 0, rival_name: null });
    expect(subject).toBe("Your brief has no rival to compare you with yet");
    expect(text).toContain("not watching a rival yet");
  });

  it("uses no urgency, no timing promise and no exclamation", () => {
    const { subject, text } = renderRivalNudge(CTX);
    expect(`${subject} ${text}`).not.toMatch(/[!]|hurry|last chance|don't miss|now\b|today|soon|right away/i);
  });

  it("escapes anything it is handed", () => {
    expectNoHtmlInjection(renderRivalNudge({ ...CTX, rival_name: PROBE }).html, "rival_name");
  });
});
