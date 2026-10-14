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

describe("emailDocument's preview text", () => {
  it("pads the preheader so body copy never leaks into the inbox preview", () => {
    expect(emailDocument("Daily brief", BODY, "Short")).toContain("&zwnj;&nbsp;&#847;");
  });

  it("hides the preheader and escapes it, ahead of the card", () => {
    const doc = emailDocument("Daily brief", BODY, 'Two <moves> & "one" gap');

    expect(doc).toContain("Two &lt;moves&gt; &amp; &quot;one&quot; gap");
    expect(doc.indexOf("display:none")).toBeLessThan(doc.indexOf('class="brief-card"'));
  });

  it("adds nothing when there is no preheader", () => {
    expect(emailDocument("Daily brief", BODY)).not.toContain("display:none");
  });
});
