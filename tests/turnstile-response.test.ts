import { afterEach, describe, expect, it, vi } from "vitest";

import { turnstileResponse } from "../app/components/turnstile-widget";

const SELECTOR = 'input[name="cf-turnstile-response"]';

class FakeInputElement {
  constructor(public value: string) {}
}

let match: unknown = null;
let queried: string | null = null;

function stubDocument(): void {
  vi.stubGlobal("document", {
    querySelector: (selector: string) => {
      queried = selector;
      return match;
    },
  });
  vi.stubGlobal("HTMLInputElement", FakeInputElement);
}

describe("turnstileResponse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries the turnstile response field", () => {
    match = null;
    stubDocument();

    turnstileResponse();

    expect(queried).toBe(SELECTOR);
  });

  it("returns an empty string when nothing matches", () => {
    match = null;
    stubDocument();

    expect(turnstileResponse()).toBe("");
  });

  it("returns an empty string when the match is not an input element", () => {
    match = { value: "  tok-123  " };
    stubDocument();

    expect(turnstileResponse()).toBe("");
  });

  it("returns the trimmed value of the matched input element", () => {
    match = new FakeInputElement("  tok-123  ");
    stubDocument();

    expect(turnstileResponse()).toBe("tok-123");
  });

  it("returns an empty string when the value is only whitespace", () => {
    match = new FakeInputElement("   ");
    stubDocument();

    expect(turnstileResponse()).toBe("");
  });
});
