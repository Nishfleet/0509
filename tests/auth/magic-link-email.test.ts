import { describe, expect, it } from "vitest";

import { extractMagicLink } from "../../e2e/inbox";
import { magicLinkEmail } from "../../app/lib/auth/magic-link-email";

const email = "reader@0509.io";
const url = "https://0509.io/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp";

describe("magicLinkEmail", () => {
  it("text carries the email, the url and the five-minute expiry", () => {
    const { text } = magicLinkEmail({ email, url });
    expect(text).toContain(email);
    expect(text).toContain(url);
    expect(text).toContain("expires in 5 minutes");
  });

  it("text tells the reader to ignore a link they did not ask for", () => {
    expect(magicLinkEmail({ email, url }).text).toContain("ignore this email");
  });

  it("keeps the subject and text free of exclamation marks", () => {
    const { subject, text } = magicLinkEmail({ email, url });
    expect(subject).not.toContain("!");
    expect(text).not.toContain("!");
  });

  it("html carries the escaped href, the card width and the dark-scheme block", () => {
    const { html } = magicLinkEmail({ email, url });
    expect(html).toContain(
      'href="https://0509.io/api/auth/magic-link/verify?token=abc123&amp;callbackURL=%2Fapp"',
    );
    expect(html).toContain("max-width:600px");
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("escapes angle brackets in the email", () => {
    const { html } = magicLinkEmail({ email: "a<b@example.com", url });
    expect(html).toContain("a&lt;b@example.com");
    expect(html).not.toContain("a<b@");
  });

  it("round-trips through the e2e link extractor", () => {
    expect(extractMagicLink(magicLinkEmail({ email, url }).html)).toBe(url);
  });
});
