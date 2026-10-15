import { linkEmailHtml, linkEmailText } from "../link-email";

const COPY = {
  approve: {
    subject: "Approve a new sign-in email for Five to Nine",
    headline: "Approve a new sign-in email",
    line: (email: string) =>
      `Someone asked to change your sign-in email to ${email}. Approve it and we will send that address one more link to confirm.`,
    button: "Approve change",
    preheader: "Nothing changes until you approve it.",
    ignore:
      "If this was not you, ignore this message. Nothing changes until both links are used, and your sign-in email stays as it is.",
  },
  confirm: {
    subject: "Confirm your new sign-in email for Five to Nine",
    headline: "Confirm your new sign-in email",
    line: (email: string) => `We sent this to ${email}. Confirm it and it becomes the address you sign in with.`,
    button: "Confirm email",
    preheader: "Confirm it and it becomes your sign-in address.",
    ignore:
      "If you did not ask to change your sign-in email, ignore this message. Nothing changes until the link is used.",
  },
} as const;

export function changeEmailEmail(input: { kind: keyof typeof COPY; email: string; url: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const copy = COPY[input.kind];
  const message = { ...copy, line: copy.line(input.email), url: input.url };
  return { subject: copy.subject, text: linkEmailText(message), html: linkEmailHtml(message) };
}
