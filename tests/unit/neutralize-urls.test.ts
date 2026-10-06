import { describe, expect, it } from "vitest";

import { neutralizeBareUrls } from "../../app/lib/neutralize-urls";

describe("neutralizeBareUrls (0509#7084)", () => {
  it("breaks a scheme so a mail or chat client cannot autolink third-party text", () => {
    expect(neutralizeBareUrls("see https://evil.example/x")).toBe("see https[:]//evil.example/x");
  });

  it("breaks a www. address that has no scheme", () => {
    expect(neutralizeBareUrls("visit www.evil.example or WWW.Evil.example")).toBe(
      "visit www[.]evil.example or WWW[.]Evil.example",
    );
  });

  it("leaves text without a link unchanged", () => {
    expect(neutralizeBareUrls("Pro $12 a month")).toBe("Pro $12 a month");
  });
});
