import { describe, expect, it } from "vitest";

import { required } from "../app/lib/required";

describe("required", () => {
  it("returns a string, a number and an object as the same value", () => {
    expect(required("0509", "home loader")).toBe("0509");
    expect(required(17, "home loader")).toBe(17);
    const entry = { name: "0509" };
    expect(required(entry, "home loader")).toBe(entry);
  });

  it("returns 0, an empty string, false and null unchanged", () => {
    expect(required(0, "home loader")).toBe(0);
    expect(required("", "home loader")).toBe("");
    expect(required(false, "home loader")).toBe(false);
    expect(required(null, "home loader")).toBeNull();
  });

  it("throws an Error whose message names the location for undefined", () => {
    expect(() => required(undefined, "home loader")).toThrowError(new Error("Missing value at home loader"));
  });
});
