import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { EYEBROW, FONT, emailDocument } from "./email-shell";

export interface RecapContext {
  change_count: number;
  latest: { rival: string; what: string } | null;
  link: string;
}

const HEADLINE = `margin:0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.02em;`;
const BODY = `margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;`;
const SUBJECT = "What Five to Nine has caught so far";

function lines(ctx: RecapContext): string[] {
  const noun = ctx.change_count === 1 ? "change" : "changes";
  const counted = `In your first days we've caught ${String(ctx.change_count)} ${noun} across your rivals.`;
  return ctx.latest === null
    ? [counted]
    : [counted, `Most recent: ${ctx.latest.rival}, ${ctx.latest.what}`, "Each one is kept as a before and after."];
}

export function renderRecap(ctx: RecapContext): RenderedBrief {
  const body = lines(ctx);
  const href = escapeHtml(ctx.link);
  return {
    subject: SUBJECT,
    text: [SUBJECT, ...body, `See everything: ${ctx.link}`].join("\n"),
    html: emailDocument(
      SUBJECT,
      [
        `<p class="brief-muted" style="${EYEBROW}">So far</p>`,
        `<p style="${HEADLINE}">${escapeHtml(SUBJECT)}</p>`,
        ...body.map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`),
        `<p style="${BODY}">See everything: <a class="brief-ink" href="${href}">${href}</a></p>`,
      ].join(""),
    ),
  };
}
