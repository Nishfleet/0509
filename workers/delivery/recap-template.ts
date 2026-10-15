import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { renderAlertFooter, type AlertFooterContext } from "../../app/lib/alert-footer";
import { BODY_STYLE, EYEBROW_STYLE, HEADLINE, emailDocument, linkParagraph } from "../../app/lib/email-shell";

export interface RecapContext {
  change_count: number;
  latest: { rival: string; what: string } | null;
  link: string;
  footer: AlertFooterContext;
}

const SUBJECT = "What Five to Nine has caught so far";
const OPEN = "See everything in Alerts";
const SUBJECT_MAX = 70;

function subjectFor(ctx: RecapContext): string {
  const noun = ctx.change_count === 1 ? "change" : "changes";
  const counted = `${String(ctx.change_count)} competitor ${noun} caught so far`;
  if (ctx.latest === null) return counted;
  const subject = `${counted}, latest: ${ctx.latest.rival}`;
  return subject.length <= SUBJECT_MAX ? subject : counted;
}

function lines(ctx: RecapContext): string[] {
  const noun = ctx.change_count === 1 ? "change" : "changes";
  const counted = `In your first days we've caught ${String(ctx.change_count)} ${noun} across your competitors.`;
  return ctx.latest === null
    ? [counted]
    : [counted, `Most recent: ${ctx.latest.rival}, ${ctx.latest.what}`, "Each one is kept as a before and after."];
}

export function renderRecap(ctx: RecapContext): RenderedBrief {
  const body = lines(ctx);
  const footer = renderAlertFooter(ctx.footer);
  return {
    subject: subjectFor(ctx),
    text: [SUBJECT, ...body, `${OPEN}: ${ctx.link}`, footer.text].join("\n\n"),
    html: emailDocument(
      SUBJECT,
      [
        `<p class="brief-muted" style="${EYEBROW_STYLE}">So far</p>`,
        `<p style="${HEADLINE}">${escapeHtml(SUBJECT)}</p>`,
        ...body.map((line) => `<p style="${BODY_STYLE}">${escapeHtml(line)}</p>`),
        linkParagraph(OPEN, ctx.link),
        footer.html,
      ].join(""),
      body[1] ?? body[0],
    ),
  };
}
