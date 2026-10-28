import { describe, expect, it } from "vitest";

import { parseBriefPayload } from "../../app/lib/brief-payload";
import { slackBriefText } from "../../app/lib/slack-brief";

const mark = (name: string, title: string) => ({ signal_id: `sig-${name}`, entity_name: name, title, jev_reason: "r" });

const payloadWith = (fields: Record<string, unknown>) =>
  parseBriefPayload(
    JSON.stringify({
      workspace_id: "ws",
      timezone: "UTC",
      period_start: "2026-09-14T08:00:00.000Z",
      period_end: "2026-09-21T08:00:00.000Z",
      headline_rank: 2,
      headline_total: 5,
      headline_movement: 1,
      headline_is_new: false,
      why_line: "Kindred is the mover",
      is_quiet_week: false,
      is_unjudged: false,
      read_this_first: [],
      brands: [],
      ...fields,
    }),
  );

describe("slackBriefText", () => {
  it("leads with the rank and its movement, then the why line, the top three marks and the link", () => {
    const text = slackBriefText(
      payloadWith({
        read_this_first: [mark("A", "one"), mark("B", "two"), mark("C", "three"), mark("D", "four")],
      }),
    );
    expect(text.split("\n")[0]).toBe("*You're #2 of 5 this week (up 1)*");
    expect(text).toContain("Kindred is the mover");
    expect(text).toContain("• A: one");
    expect(text).toContain("• C: three");
    expect(text).not.toContain("• D");
    expect(text.endsWith("<https://0509.io/app/brief|Open the full brief in Five to Nine>")).toBe(true);
  });

  it("says holding steady, down and first ranking in plain words", () => {
    expect(slackBriefText(payloadWith({ headline_movement: 0 }))).toContain("(holding steady)");
    expect(slackBriefText(payloadWith({ headline_movement: -3 }))).toContain("(down 3)");
    expect(slackBriefText(payloadWith({ headline_is_new: true }))).toContain("(your first ranking)");
  });

  it("falls back to a plain title when the week is unjudged or has no rank", () => {
    expect(slackBriefText(payloadWith({ is_unjudged: true }))).toContain("*Your weekly brief*");
    expect(slackBriefText(payloadWith({ headline_rank: null }))).toContain("*Your weekly brief*");
  });

  it("escapes Slack control characters and defuses bare links in rival text", () => {
    const text = slackBriefText(
      payloadWith({ read_this_first: [mark("<!channel> A&B", "see https://evil.example/x now")] }),
    );
    expect(text).not.toContain("<!channel>");
    expect(text).toContain("&lt;!channel&gt; A&amp;B");
    expect(text).not.toContain("https://evil.example/x");
  });
});
