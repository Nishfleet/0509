import type { RenderedBrief } from "../../app/lib/brief-payload";
import { SUPPORT_ADDRESS } from "../../app/components/footer";
import { escapeHtml } from "../../app/lib/html";
import { formatDate } from "./brief-template";
import { BODY_STYLE, EYEBROW_STYLE, HEADLINE, emailDocument, linkParagraph } from "../../app/lib/email-shell";

export interface TrialEndingContext {
  plan: string;
  monthly_price_eur: number;
  ends_at: string;
  timezone: string;
  link: string;
}

function copy(ctx: TrialEndingContext) {
  const ends = formatDate(ctx.ends_at, ctx.timezone, false);
  return {
    subject: `Your ${ctx.plan} trial ends on ${ends}`,
    lines: [
      `Your free trial of ${ctx.plan} ends on ${ends}. After that your card is charged €${String(ctx.monthly_price_eur)} a month and ${ctx.plan} carries on.`,
      `Not for you? Cancel before then and you won't be charged. Open Settings and choose Manage or cancel plan.`,
      `Questions? Reply to this email or write to ${SUPPORT_ADDRESS}.`,
    ],
  };
}

export function renderTrialEnding(ctx: TrialEndingContext): RenderedBrief {
  const { subject, lines } = copy(ctx);
  return {
    subject,
    text: [subject, ...lines, `Manage or cancel your plan: ${ctx.link}`].join("\n"),
    html: emailDocument(
      subject,
      [
        `<p class="brief-muted" style="${EYEBROW_STYLE}">Your trial</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        ...lines.map((line) => `<p style="${BODY_STYLE}">${escapeHtml(line)}</p>`),
        linkParagraph("Manage or cancel your plan", ctx.link),
      ].join(""),
      lines[0],
    ),
  };
}
