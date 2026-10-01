import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import type { ChangeMark } from "../../app/lib/site-change";
import { formatDate } from "./brief-template";
import { EYEBROW, FONT, emailDocument } from "./email-shell";

export interface ChangeContext {
  headline: string;
  observed_at: string;
  mark: ChangeMark | null;
  link: string;
  timezone: string;
}

const HEADLINE = `margin:0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.02em;`;
const BODY = `margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;`;

function markLines(mark: ChangeMark | null): string[] {
  if (mark === null) return [];
  return [
    ...(mark.removed === null ? [] : [`Before: ${mark.removed}`]),
    ...(mark.added === null ? [] : [`After: ${mark.added}`]),
  ];
}

export function renderChange(ctx: ChangeContext): RenderedBrief {
  const seen = `Seen at ${formatDate(ctx.observed_at, ctx.timezone, true)}.`;
  const lines = [seen, ...markLines(ctx.mark)];
  const href = escapeHtml(ctx.link);
  return {
    subject: ctx.headline,
    text: [ctx.headline, ...lines, `See the before and after in Five to Nine: ${ctx.link}`].join("\n"),
    html: emailDocument(
      ctx.headline,
      [
        `<p class="brief-muted" style="${EYEBROW}">Price or plan change</p>`,
        `<p style="${HEADLINE}">${escapeHtml(ctx.headline)}</p>`,
        ...lines.map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`),
        `<p style="${BODY}">See the before and after in Five to Nine: <a class="brief-ink" href="${href}">${href}</a></p>`,
      ].join(""),
    ),
  };
}
