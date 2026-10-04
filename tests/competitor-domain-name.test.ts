import { describe, expect, it } from "vitest";

import { nameFromDomain } from "../app/lib/competitor/domain-name";

describe("nameFromDomain", () => {
  it("turns a bare domain into a plain brand name", () => {
    expect(nameFromDomain("hoka.com")).toBe("Hoka");
    expect(nameFromDomain("on-running.com")).toBe("On Running");
    expect(nameFromDomain("rothys.co.uk")).toBe("Rothys");
  });

  it("gives nothing for a host with no name part", () => {
    expect(nameFromDomain("com")).toBeNull();
  });
});
