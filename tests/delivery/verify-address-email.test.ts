import { describe, expect, it } from "vitest";

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
    expect(html).toContain('href="https://0509.io/v?t=1&amp;u=2"');
    expect(html).toContain("Confirm this address");
  });
});
