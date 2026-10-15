import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { renderAlertFooter, type AlertFooterContext } from "../../app/lib/alert-footer";
import { BODY_STYLE, EYEBROW_STYLE, HEADLINE, emailDocument, linkParagraph } from "../../app/lib/email-shell";

export interface MonthlyContext {
  month: string;
  change_count: number;
  moves: readonly { rival: string; what: string }[];
  link: string;
  footer: AlertFooterContext;
}

const SUBJECT = "Your month in competitors";
const OPEN = "See everything in Alerts";

function lines(ctx: MonthlyContext): string[] {
  const noun = ctx.change_count === 1 ? "change" : "changes";
  const counted = `In ${ctx.month} we caught ${String(ctx.change_count)} ${noun} across your competitors.`;
  if (ctx.moves.length === 0) return [counted];
  return [counted, "Most recent:", ...ctx.moves.map((move) => `${move.rival}, ${move.what}`)];
}

export function renderMonthly(ctx: MonthlyContext): RenderedBrief {
  const body = lines(ctx);
  const footer = renderAlertFooter(ctx.footer);
  return {
    subject: SUBJECT,
    text: [SUBJECT, body[0], body.slice(1).join("\n"), `${OPEN}: ${ctx.link}`, footer.text]
      .filter((block) => block !== "")
      .join("\n\n"),
    html: emailDocument(
      SUBJECT,
      [
        `<p class="brief-muted" style="${EYEBROW_STYLE}">${escapeHtml(ctx.month)}</p>`,
        `<p style="${HEADLINE}">${escapeHtml(SUBJECT)}</p>`,
        ...body.map((line) => `<p style="${BODY_STYLE}">${escapeHtml(line)}</p>`),
        linkParagraph(OPEN, ctx.link),
        footer.html,
      ].join(""),
      body[0],
    ),
  };
}
