import { describe, expect, it } from "vitest";

import { PROBE, expectNoHtmlInjection } from "../email-html-injection";
import { verifyAddressEmail } from "../../app/lib/verify-address-email";

const EMAIL = "a&b<x>@example.com";
const LINK = "https://0509.io/v?t=1&u=2";

describe("verifyAddressEmail (0509#6554)", () => {
  it("subjects the confirm-delivery-email line exactly", () => {
    expect(verifyAddressEmail({ email: EMAIL, url: LINK }).subject).toBe(
      "Confirm your delivery email for Five to Nine",
    );
  });

  it("keeps the text part verbatim in email and link", () => {
    const { text } = verifyAddressEmail({ email: EMAIL, url: LINK });
    expect(text).toContain(EMAIL);
    expect(text).toContain(LINK);
    expect(text).toContain("Nothing happens until the link is used.");
  });

  it("escapes the address and link in html and leaves the text raw", () => {
    const { text, html } = verifyAddressEmail({ email: EMAIL, url: LINK });
    expect(html).toContain("a&amp;b&lt;x&gt;@example.com");
    expect(html).toContain("t=1&amp;u=2");
    expect(html).not.toContain("<x>");
    expect(html).not.toContain("t=1&u=2");
    expect(text).toContain(EMAIL);
    expect(text).toContain(LINK);
  });

  it("puts the link behind the confirm button", () => {
    const { html } = verifyAddressEmail({ email: EMAIL, url: LINK });
    const anchor = html.slice(html.indexOf("<a "), html.indexOf("</a>") + 4);
    expect(anchor).toContain('href="https://0509.io/v?t=1&amp;u=2"');
    expect(anchor).toContain("Confirm this address");
  });
});

/**
 * 0509#7020: the confirm-delivery email escapes both fields by hand. This
 * table plants the injection probe in every string field, one row per field,
 * so a missed escapeHtml turns CI red — the plain template module stays.
 */
describe("every string field carries the injection probe escaped, never raw (0509#7020)", () => {
  it.each([
    ["email", { email: PROBE, url: LINK }],
    ["url", { email: EMAIL, url: PROBE }],
  ] as [string, { email: string; url: string }][])("%s lands in the html only escaped", (field, input) => {
    expectNoHtmlInjection(verifyAddressEmail(input).html, field);
  });
});
