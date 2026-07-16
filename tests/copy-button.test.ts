import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync("app/components/copy-button.tsx", "utf8");

describe("CopyButton", () => {
  it("exposes copied and clipboard failure feedback that can be retried", () => {
    expect(source).toContain("aria-live=\"polite\"");
    expect(source).toContain("Could not copy");
    expect(source).toContain("Try again");
    expect(source).toContain("navigator.clipboard.writeText");
  });
});
