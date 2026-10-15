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

export function teammateInviteEmail(input: { email: string; url: string; addedBy: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const message: LinkEmail = {
    subject: `${input.addedBy} wants to send you the Five to Nine brief`,
    headline: "Get the weekly brief",
    line: `${input.addedBy} added ${input.email} to receive their weekly Five to Nine brief: what their competitors changed and how they rank. Confirm to start getting it.`,
    button: "Yes, send me the brief",
    url: input.url,
    ignore:
      "If you do not want it, ignore this email. Nothing is sent until you use the link, and every brief has an unsubscribe link.",
    preheader: "Confirm to start getting their weekly brief.",
  };
  return { subject: message.subject, text: linkEmailText(message), html: linkEmailHtml(message) };
}
