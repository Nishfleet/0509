import { describe, expect, it } from "vitest";

import { changeHeadline, pageLabel } from "../app/lib/site-change";

describe("the label a page role turns into", () => {
  it.each([
    ["home", "homepage"],
    ["pricing", "pricing page"],
    ["product", "product page"],
    ["blog", "blog"],
    ["careers", "careers page"],
    ["legal", "legal page"],
  ])("reads the role %s as %s", (role, label) => {
    expect(pageLabel(role)).toBe(label);
  });

  it("falls back to website for a role the table does not hold", () => {
    expect(pageLabel("other")).toBe("website");
    expect(pageLabel("")).toBe("website");
  });
});

describe("the sentence a customer reads for a site change", () => {
  it("names the company and its page when someone else changed it", () => {
    expect(changeHeadline({ name: "Acme", isSelf: false, role: "legal" })).toBe("Acme changed its legal page");
  });

  it("says your page when the customer watched its own site", () => {
    expect(changeHeadline({ name: "Acme", isSelf: true, role: "legal" })).toBe("Your legal page changed");
  });
});
