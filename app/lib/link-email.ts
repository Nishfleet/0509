import { SUPPORT_ADDRESS } from "../components/footer";
import { escapeHtml } from "./html";
import { supportLineHtml } from "./alert-footer";
import { BODY_STYLE, FONT, HEADLINE, emailDocument, linkParagraph } from "./email-shell";

export interface LinkEmail {
  readonly subject: string;
  readonly headline: string;
  readonly line: string;
  readonly button: string;
  readonly url: string;
  readonly ignore: string;
  readonly preheader: string;
}

export function linkEmailText(input: LinkEmail): string {
  return [
    input.headline,
    "",
    input.line,
    "",
    `${input.button}: ${input.url}`,
    "",
    input.ignore,
    "",
    `Questions? Write to ${SUPPORT_ADDRESS}.`,
  ].join("\n");
}

export function linkEmailHtml(input: LinkEmail): string {
  const url = escapeHtml(input.url);
  const small = `margin:16px 0 0;font-family:${FONT};font-size:14px;line-height:20px;`;
  return emailDocument(
    input.subject,
    [
      `<p style="${HEADLINE}">${escapeHtml(input.headline)}</p>`,
      `<p style="${BODY_STYLE}">${escapeHtml(input.line)}</p>`,
      linkParagraph(input.button, input.url),
      `<p class="brief-muted" style="${small}">If the button doesn't work, paste this address into your browser:<br><span style="word-break:break-all;">${url}</span></p>`,
      `<p class="brief-muted" style="${small}">${escapeHtml(input.ignore)}</p>`,
      supportLineHtml(),
    ].join(""),
    input.preheader,
  );
}
