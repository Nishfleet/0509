import { describe, expect, it } from "vitest";

import { creatorRows } from "../../../app/lib/identity/card-fields";
import { normaliseSubject, type Subject } from "../../../app/lib/identity/normalise";

function subject(input: string): Subject {
  const result = normaliseSubject(input);
  if (!result.ok) throw new Error(`${input} did not normalise: ${result.reason}`);
  return result.subject;
}

describe("the identity card creator rows", () => {
  it("names the platform and the handle for a channel subject", () => {
    expect(creatorRows(subject("https://www.youtube.com/@veritasium"))).toEqual({
      channel: "YouTube",
      handle: "@veritasium",
    });
  });

  it("leaves the channel empty for a bare handle, and still shows the handle", () => {
    expect(creatorRows(subject("@someone"))).toEqual({ channel: null, handle: "@someone" });
  });

  it("adds no creator rows for a domain subject", () => {
    expect(creatorRows(subject("gymshark.com"))).toBeNull();
  });
});
