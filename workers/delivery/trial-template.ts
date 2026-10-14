import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { formatDate } from "./brief-template";
import { EYEBROW, FONT, emailDocument } from "./email-shell";

export interface TrialEndingContext {
  plan: string;
  monthly_price_eur: number;
  ends_at: string;
  timezone: string;
  link: string;
}

const HEADLINE = `margin:0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.02em;`;
const BODY = `margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;`;

function copy(ctx: TrialEndingContext) {
  const ends = formatDate(ctx.ends_at, ctx.timezone, false);
  return {
    subject: `Your ${ctx.plan} trial ends on ${ends}`,
    lines: [
      `Your free trial of ${ctx.plan} ends on ${ends}. After that your card is charged €${String(ctx.monthly_price_eur)} a month and ${ctx.plan} carries on.`,
      `Not for you? Cancel before then and you won't be charged. Open Settings and choose Manage or cancel plan.`,
    ],
  };
}

export function renderTrialEnding(ctx: TrialEndingContext): RenderedBrief {
  const { subject, lines } = copy(ctx);
  const href = escapeHtml(ctx.link);
  return {
    subject,
    text: [subject, ...lines, `Manage or cancel your plan: ${ctx.link}`].join("\n"),
    html: emailDocument(
      subject,
      [
        `<p class="brief-muted" style="${EYEBROW}">Your trial</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        ...lines.map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`),
        `<p style="${BODY}">Manage or cancel your plan: <a class="brief-ink" href="${href}">${href}</a></p>`,
      ].join(""),
      lines[0],
    ),
  };
}
