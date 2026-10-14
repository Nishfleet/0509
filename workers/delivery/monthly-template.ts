import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { renderAlertFooter, type AlertFooterContext } from "./alert-footer";
import { EYEBROW, FONT, emailDocument } from "./email-shell";

export interface MonthlyContext {
  month: string;
  change_count: number;
  moves: readonly { rival: string; what: string }[];
  link: string;
  footer: AlertFooterContext;
}

const HEADLINE = `margin:0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.02em;`;
const BODY = `margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;`;
const SUBJECT = "Your month in rivals";

function lines(ctx: MonthlyContext): string[] {
  const noun = ctx.change_count === 1 ? "change" : "changes";
  const counted = `In ${ctx.month} we caught ${String(ctx.change_count)} ${noun} across your rivals.`;
  if (ctx.moves.length === 0) return [counted];
  return [counted, "Most recent:", ...ctx.moves.map((move) => `${move.rival}, ${move.what}`)];
}

export function renderMonthly(ctx: MonthlyContext): RenderedBrief {
  const body = lines(ctx);
  const href = escapeHtml(ctx.link);
  const footer = renderAlertFooter(ctx.footer);
  return {
    subject: SUBJECT,
    text: [SUBJECT, ...body, `See everything: ${ctx.link}`, footer.text].join("\n"),
    html: emailDocument(
      SUBJECT,
      [
        `<p class="brief-muted" style="${EYEBROW}">${escapeHtml(ctx.month)}</p>`,
        `<p style="${HEADLINE}">${escapeHtml(SUBJECT)}</p>`,
        ...body.map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`),
        `<p style="${BODY}">See everything: <a class="brief-ink" href="${href}">${href}</a></p>`,
        footer.html,
      ].join(""),
      body[0],
    ),
  };
}
