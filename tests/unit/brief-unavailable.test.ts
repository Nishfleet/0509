import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BriefUnavailable } from "../../app/components/brief-unavailable";

describe("BriefUnavailable", () => {
  const html = renderToStaticMarkup(createElement(BriefUnavailable));

  it("keeps the sentence the page has always shown", () => {
    expect(html).toContain("This brief could not be shown here.");
  });

  it("says the other weeks are on the page and the email has the brief", () => {
    expect(html).toContain("listed below");
    expect(html).toContain("the email we sent has the same");
  });

  it("gives the support address as a mailto link", () => {
    expect(html).toContain('href="mailto:support@0509.io"');
  });
});
