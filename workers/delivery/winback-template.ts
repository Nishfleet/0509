import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { renderAlertFooter, type AlertFooterContext } from "../../app/lib/alert-footer";
import { BODY_STYLE, EYEBROW_STYLE, HEADLINE, emailDocument, linkParagraph } from "../../app/lib/email-shell";

export interface WinbackContext {
  change_count: number;
  latest: { rival: string; what: string } | null;
  link: string;
  footer: AlertFooterContext;
}

const SUBJECT = "What your competitors did while you were away";
const OPEN = "Catch up in Five to Nine";

function lines(ctx: WinbackContext): string[] {
  const noun = ctx.change_count === 1 ? "change" : "changes";
  const counted = `Since you last opened Five to Nine we've caught ${String(ctx.change_count)} ${noun} across your competitors.`;
  return ctx.latest === null ? [counted] : [counted, `Most recent: ${ctx.latest.rival}, ${ctx.latest.what}`];
}

export function renderWinback(ctx: WinbackContext): RenderedBrief {
  const body = lines(ctx);
  const footer = renderAlertFooter(ctx.footer);
  return {
    subject: SUBJECT,
    text: [SUBJECT, ...body, `${OPEN}: ${ctx.link}`, footer.text].join("\n\n"),
    html: emailDocument(
      SUBJECT,
      [
        `<p class="brief-muted" style="${EYEBROW_STYLE}">Catch up</p>`,
        `<p style="${HEADLINE}">${escapeHtml(SUBJECT)}</p>`,
        ...body.map((line) => `<p style="${BODY_STYLE}">${escapeHtml(line)}</p>`),
        linkParagraph(OPEN, ctx.link),
        footer.html,
      ].join(""),
      body[0],
    ),
  };
}
