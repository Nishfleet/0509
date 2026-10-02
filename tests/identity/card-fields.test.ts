import { describe, expect, it } from "vitest";

import { creatorRows, editedFields } from "../../app/lib/identity/card-fields";
import { normaliseSubject, type Subject } from "../../app/lib/identity/normalise";

function subject(input: string): Subject {
  const result = normaliseSubject(input);
  if (!result.ok) throw new Error(`${input} did not normalise: ${result.reason}`);
  return result.subject;
}

describe("editedFields", () => {
  it("reports no edited field for an empty draft", () => {
    expect(editedFields({})).toEqual([]);
  });

  it("lists the edited fields in DRAFT_FIELDS order, not the draft key order", () => {
    expect(editedFields({ description: "x", name: "y" })).toEqual(["name", "description"]);
  });

  it("counts an empty string as edited", () => {
    expect(editedFields({ name: "" })).toEqual(["name"]);
  });

  it("treats an explicit undefined value as not edited", () => {
    expect(editedFields({ description: undefined })).toEqual([]);
  });
});

describe("creatorRows", () => {
  it("adds no creator rows for a domain subject", () => {
    expect(creatorRows(subject("gymshark.com"))).toBeNull();
  });

  it("names the platform and the handle for a youtube channel subject", () => {
    expect(creatorRows(subject("https://www.youtube.com/@x"))).toEqual({ channel: "YouTube", handle: "@x" });
  });
});
