import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { turnstileResponse } from "../app/components/turnstile-widget";

const SELECTOR = 'input[name="cf-turnstile-response"]';

class FakeInputElement {
  constructor(public value: string) {}
}

const querySelector = vi.fn();

function stubDocument(): void {
  // The node project has no `document` or `HTMLInputElement`, so both are
  // stubbed: querySelector returns the per-test fixture, and HTMLInputElement
  // is the stub class the source's `instanceof` check resolves against.
  vi.stubGlobal("document", { querySelector });
  vi.stubGlobal("HTMLInputElement", FakeInputElement);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("turnstileResponse", () => {
  beforeEach(() => {
    querySelector.mockReset();
  });

  it("queries the turnstile response field", () => {
    querySelector.mockReturnValue(null);
    stubDocument();

    turnstileResponse();

    expect(querySelector).toHaveBeenCalledWith(SELECTOR);
  });

  it("returns an empty string when nothing matches", () => {
    querySelector.mockReturnValue(null);
    stubDocument();

    expect(turnstileResponse()).toBe("");
    expect(querySelector).toHaveBeenCalledWith(SELECTOR);
  });

  it("returns an empty string when the match is not an input element", () => {
    querySelector.mockReturnValue({ value: "  tok-123  " });
    stubDocument();

    expect(turnstileResponse()).toBe("");
  });

  it("returns the trimmed value of the matched input element", () => {
    querySelector.mockReturnValue(new FakeInputElement("  tok-123  "));
    stubDocument();

    expect(turnstileResponse()).toBe("tok-123");
  });

  it("returns an empty string when the value is only whitespace", () => {
    querySelector.mockReturnValue(new FakeInputElement("   "));
    stubDocument();

    expect(turnstileResponse()).toBe("");
  });
});
