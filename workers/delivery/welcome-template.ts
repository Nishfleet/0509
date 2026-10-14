import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { formatDate } from "./brief-template";
import { EYEBROW, FONT, emailDocument } from "./email-shell";

export interface WelcomeContext {
  rivals: readonly string[];
  rival_count: number;
  first_brief_at: string | null;
  timezone: string;
  alerts_link: string;
}

const HEADLINE = `margin:0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.02em;`;
const BODY = `margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;`;

function watching(ctx: WelcomeContext): string {
  if (ctx.rival_count === 0)
    return "Add the rivals you want to keep an eye on and we'll start reading their sites straight away.";
  const more = ctx.rival_count - ctx.rivals.length;
  const names = ctx.rivals.join(", ") + (more > 0 ? ` and ${String(more)} more` : "");
  return `We're watching ${names}. We're reading their sites now, so anything that changes from here shows up as a before and after.`;
}

function copy(ctx: WelcomeContext) {
  const brief =
    ctx.first_brief_at === null
      ? "Your first ranking arrives with your weekly brief."
      : `Your first ranking arrives with your weekly brief on ${formatDate(ctx.first_brief_at, ctx.timezone, false)}.`;
  return {
    subject: "Welcome to Five to Nine",
    lines: [
      watching(ctx),
      "Pricing changes and site breakages email you the same day. Everything else waits for the brief.",
      brief,
    ],
  };
}

export function renderWelcome(ctx: WelcomeContext): RenderedBrief {
  const { subject, lines } = copy(ctx);
  const href = escapeHtml(ctx.alerts_link);
  return {
    subject,
    text: [subject, ...lines, `See what changed: ${ctx.alerts_link}`].join("\n\n"),
    html: emailDocument(
      subject,
      [
        `<p class="brief-muted" style="${EYEBROW}">You're in</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        ...lines.map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`),
        `<p style="${BODY}"><a class="brief-ink" href="${href}">See what changed</a></p>`,
      ].join(""),
      lines[0],
    ),
  };
}
