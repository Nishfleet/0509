import { describe, expect, it } from "vitest";

import { changeEmailEmail } from "../app/lib/auth/change-email-email";
import { magicLinkEmail } from "../app/lib/auth/magic-link-email";
import { verifyAddressEmail } from "../app/lib/verify-address-email";

const url = "https://0509.io/x?t=1";

const mails = [
  ["sign-in", magicLinkEmail({ email: "a@b.co", url })],
  ["delivery address", verifyAddressEmail({ email: "a@b.co", url })],
  ["approve change", changeEmailEmail({ kind: "approve", email: "a@b.co", url })],
  ["confirm change", changeEmailEmail({ kind: "confirm", email: "a@b.co", url })],
] as const;

describe.each(mails)("the %s email", (_name, mail) => {
  it("opens with the wordmark and a hidden preview line before the card", () => {
    expect(mail.html).toContain("max-height:0;overflow:hidden");
    expect(mail.html.indexOf("max-height:0")).toBeLessThan(mail.html.indexOf(`class="ftn-card"`));
    expect(mail.html).toContain(">09</span>");
  });

  it("makes the link button the first anchor and ends with the support address", () => {
    const first = mail.html.slice(mail.html.indexOf("<a "), mail.html.indexOf("</a>"));
    expect(first).toContain('href="https://0509.io/x?t=1"');
    expect(mail.html).toContain('href="mailto:support@0509.io"');
    expect(mail.text).toContain("Questions? Write to support@0509.io.");
  });

  it("keeps exclamation marks out of every part", () => {
    expect(mail.subject + mail.text).not.toContain("!");
  });
});
