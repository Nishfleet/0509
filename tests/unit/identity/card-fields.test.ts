import { describe, expect, it } from "vitest";

import { isDraftSave } from "../../../app/lib/identity/card-fields";

describe("isDraftSave", () => {
  it("returns true when intent is draft", () => {
    const form = new FormData();
    form.set("intent", "draft");
    expect(isDraftSave(form)).toBe(true);
  });

  it("returns false when intent is missing", () => {
    const form = new FormData();
    form.set("subject", "example.com");
    expect(isDraftSave(form)).toBe(false);
  });

  it("returns false for undefined formData", () => {
    expect(isDraftSave(undefined)).toBe(false);
  });
});
