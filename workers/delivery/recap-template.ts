import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { renderAlertFooter, type AlertFooterContext } from "./alert-footer";
import { BODY, EYEBROW, HEADLINE, emailDocument, linkParagraph } from "./email-shell";

export interface RecapContext {
  change_count: number;
  latest: { rival: string; what: string } | null;
  link: string;
  footer: AlertFooterContext;
}

const SUBJECT = "What Five to Nine has caught so far";

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
    subject: SUBJECT,
    text: [SUBJECT, ...body, `See everything: ${ctx.link}`, footer.text].join("\n"),
    html: emailDocument(
      SUBJECT,
      [
        `<p class="brief-muted" style="${EYEBROW}">So far</p>`,
        `<p style="${HEADLINE}">${escapeHtml(SUBJECT)}</p>`,
        ...body.map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`),
        linkParagraph("See everything", ctx.link),
        footer.html,
      ].join(""),
      body[0],
    ),
  };
}
