import { describe, expect, it } from "vitest";

import { editedFields } from "../../app/lib/identity/card-fields";

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
