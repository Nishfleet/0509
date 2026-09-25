import { describe, expect, it } from "vitest";

import { isDraftWrite } from "../../../app/lib/identity/card-fields";

describe("isDraftWrite", () => {
  it("returns true when intent is draft", () => {
    const form = new FormData();
    form.set("intent", "draft");
    expect(isDraftWrite(form)).toBe(true);
  });

  it("returns true when intent is revert", () => {
    const form = new FormData();
    form.set("intent", "revert");
    expect(isDraftWrite(form)).toBe(true);
  });

  it("returns false when intent is missing", () => {
    const form = new FormData();
    form.set("subject", "example.com");
    expect(isDraftWrite(form)).toBe(false);
  });

  it("returns false for undefined formData", () => {
    expect(isDraftWrite(undefined)).toBe(false);
  });
});
