import { describe, expect, it } from "vitest";

import {
  mentionReasonLine,
  MENTION_MATTERS_WHEN_FALSE,
  MENTION_MATTERS_WHEN_TRUE,
} from "../../app/lib/mentions/reason-customer";
import type { NoulAction } from "../../app/lib/jev/thresholds";

const BANNED = /probability|confidence|mention_matters|mention_is_about_brand|\b0\.\d/i;

const ACTIONS: NoulAction[] = ["act", "maybe", "reject"];

describe("mentionReasonLine", () => {
  it("gives every band a non-empty sentence with no probability, question id or confidence label", () => {
    for (const action of ACTIONS) {
      const line = mentionReasonLine(action);
      expect(line.trim()).not.toBe("");
      expect(line).not.toMatch(BANNED);
    }
  });

  it("reads as a sentence, not as a band code", () => {
    const lines = ACTIONS.map((action) => mentionReasonLine(action));
    expect(new Set(lines).size).toBe(ACTIONS.length);
    for (const line of lines) {
      expect(line).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("is the D6 criteria the judge itself asked for, so the two cannot drift", () => {
    expect(mentionReasonLine("act")).toBe(MENTION_MATTERS_WHEN_TRUE);
    expect(mentionReasonLine("reject")).toBe(MENTION_MATTERS_WHEN_FALSE);
    expect(mentionReasonLine("maybe")).not.toBe(MENTION_MATTERS_WHEN_TRUE);
    expect(mentionReasonLine("maybe")).not.toBe(MENTION_MATTERS_WHEN_FALSE);
  });
});
