import { describe, expect, it } from "vitest";

import { offBrandsSentence } from "../../app/lib/off-brands";

describe("the off-brands footer sentence", () => {
  it("stays silent when no brand is off", () => {
    expect(offBrandsSentence([])).toBeNull();
  });

  it("names the single off brand", () => {
    expect(offBrandsSentence(["Kindred"])).toBe("Kindred is switched off, so nothing from it shows here.");
  });

  it("joins two off brands with and", () => {
    expect(offBrandsSentence(["Kindred", "Casetta"])).toBe(
      "Kindred and Casetta are switched off, so nothing from them shows here.",
    );
  });

  it("uses the Oxford comma for three or more off brands", () => {
    expect(offBrandsSentence(["Kindred", "Casetta", "Bramble"])).toBe(
      "Kindred, Casetta, and Bramble are switched off, so nothing from them shows here.",
    );
  });
});
