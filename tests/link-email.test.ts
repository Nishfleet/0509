import { describe, expect, it } from "vitest";

import { linkEmailHtml } from "../workers/delivery/link-email";
import { changeEmailEmail } from "../workers/delivery/change-email-email";
import { magicLinkEmail } from "../workers/delivery/magic-link-email";
import { SUPPORT_ADDRESS } from "../app/components/footer";
import { verifyAddressEmail } from "../workers/delivery/verify-address-email";

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
    expect(mail.html.indexOf("max-height:0")).toBeLessThan(mail.html.indexOf(`class="brief-card"`));
    expect(mail.html).toContain(">09</span>");
  });

  it("makes the link button the first anchor and ends with the support address", () => {
    const first = mail.html.slice(mail.html.indexOf("<a "), mail.html.indexOf("</a>"));
    expect(first).toContain('href="https://0509.io/x?t=1"');
    expect(mail.html).toContain(`href="mailto:${SUPPORT_ADDRESS}"`);
    expect(mail.text).toContain(`Questions? Write to ${SUPPORT_ADDRESS}.`);
  });

  it("keeps exclamation marks out of every part", () => {
    expect(mail.subject + mail.text).not.toContain("!");
  });
});

describe("the link email builder", () => {
  it("escapes a preheader that carries markup", () => {
    const html = linkEmailHtml({
      subject: "s",
      headline: "h",
      line: "l",
      button: "b",
      url,
      ignore: "i",
      preheader: `<img src=x onerror=alert(1)>`,
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
