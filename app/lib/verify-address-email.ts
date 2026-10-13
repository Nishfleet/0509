import { linkEmailHtml, linkEmailText, type LinkEmail } from "./link-email";

export function verifyAddressEmail(input: { email: string; url: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const message: LinkEmail = {
    subject: "Confirm your delivery email for Five to Nine",
    headline: "Confirm your delivery email",
    line: `We sent this to ${input.email}. Confirm it and the weekly brief goes there.`,
    button: "Confirm this address",
    url: input.url,
    ignore:
      "If you did not change your delivery address on Five to Nine, ignore this email. Nothing happens until the link is used.",
    preheader: "Confirm it and the weekly brief goes there.",
  };
  return { subject: message.subject, text: linkEmailText(message), html: linkEmailHtml(message) };
}
