import { describe, expect, it } from "vitest";

import { emailDocument } from "../../workers/delivery/email-shell";

const WORDMARK_END = "09</span></p>";
const BODY = '<p>Ship "it" & <b>now</b></p>';

describe("emailDocument's html shell (0509#6525)", () => {
  it("opens with a doctype and closes the html element", () => {
    const doc = emailDocument("Daily brief", BODY);
    expect(doc).toMatch(/^<!doctype html>/);
    expect(doc).toMatch(/<\/html>$/);
  });

  it("escapes the title's ampersand and angle brackets into entities", () => {
    const doc = emailDocument("A & <B>", BODY);
    expect(doc).toContain("<title>A &amp; &lt;B&gt;</title>");
  });

  it("drops the body in verbatim, once, after the wordmark and before </body>", () => {
    const doc = emailDocument("Daily brief", BODY);
    expect(doc).toContain(BODY);
    expect(doc.split(BODY)).toHaveLength(2);
    const bodyIndex = doc.indexOf(BODY);
    expect(bodyIndex).toBeGreaterThan(doc.indexOf(WORDMARK_END));
    expect(bodyIndex).toBeLessThan(doc.indexOf("</body>"));
  });

  it("declares the light-dark color-scheme meta for mail clients", () => {
    const doc = emailDocument("Daily brief", BODY);
    expect(doc).toContain('<meta name="color-scheme" content="light dark">');
  });
});
