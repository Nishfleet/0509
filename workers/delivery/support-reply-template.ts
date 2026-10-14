import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { BODY, EYEBROW, HEADLINE, emailDocument } from "./email-shell";

const SUBJECT = "We got your message";

const LINES = [
  "Thanks for writing to Five to Nine. A person reads every message, and you will hear back from us within three days.",
  "If something is urgent or you forgot a detail, just reply to this email and add it.",
];

export function renderSupportReply(): RenderedBrief {
  return {
    subject: SUBJECT,
    text: [SUBJECT, ...LINES, "Five to Nine"].join("\n\n"),
    html: emailDocument(
      SUBJECT,
      [
        `<p class="brief-muted" style="${EYEBROW}">Support</p>`,
        `<p style="${HEADLINE}">${escapeHtml(SUBJECT)}</p>`,
        ...LINES.map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`),
      ].join(""),
      LINES[0],
    ),
  };
}
