import { describe, expect, it } from "vitest";

import { ONBOARDING_IDENTITY_PATH, subjectRedirect } from "../app/lib/onboarding-subject";

describe("ONBOARDING_IDENTITY_PATH", () => {
  it("is the identity card path", () => {
    expect(ONBOARDING_IDENTITY_PATH).toBe("/onboarding/identity");
  });
});

describe("subjectRedirect", () => {
  it("encodes a multi-word subject that contains an ampersand", () => {
    expect(subjectRedirect("  my brand & co  ")).toBe("/onboarding/identity?subject=my%20brand%20%26%20co");
  });

  it("returns null for a File value", () => {
    expect(subjectRedirect(new File([""], "a.txt"))).toBeNull();
  });
});
