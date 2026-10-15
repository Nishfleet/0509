import { linkEmailHtml, linkEmailText, type LinkEmail } from "./link-email";

import { MAGIC_LINK_TTL_SECONDS } from "../../app/lib/auth/magic-link-ttl";
const TTL_MINUTES = MAGIC_LINK_TTL_SECONDS / 60;

export function magicLinkEmail(input: { email: string; url: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const message: LinkEmail = {
    subject: "Your sign-in link for Five to Nine",
    headline: "Sign in to Five to Nine",
    line: `We sent this link to ${input.email}. It works once and expires in ${String(TTL_MINUTES)} minutes.`,
    button: "Sign in",
    url: input.url,
    ignore: "If you did not ask to sign in, ignore this email. Nothing happens until the link is used.",
    preheader: `Works once, expires in ${String(TTL_MINUTES)} minutes.`,
  };
  return { subject: message.subject, text: linkEmailText(message), html: linkEmailHtml(message) };
}
