import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { formatDate } from "./brief-template";
import { supportLineHtml, supportLineText } from "./alert-footer";
import { BODY, EYEBROW, HEADLINE, emailDocument, linkParagraph } from "./email-shell";

export interface WelcomeContext {
  rivals: readonly string[];
  rival_count: number;
  first_brief_at: string | null;
  timezone: string;
  home_link: string;
}

function watching(ctx: WelcomeContext): string {
  if (ctx.rival_count === 0) return "Add the rivals you want to keep an eye on and we'll start reading their sites.";
  const more = ctx.rival_count - ctx.rivals.length;
  const names = ctx.rivals.join(", ") + (more > 0 ? ` and ${String(more)} more` : "");
  return `We're watching ${names}. Anything that changes on their sites from here is kept as a before and after.`;
}

const SUBJECT_MAX = 70;

function subjectFor(ctx: WelcomeContext): string {
  if (ctx.rival_count === 0 || ctx.rivals.length === 0) return "Welcome to Five to Nine";
  const shown = ctx.rivals.slice(0, 2);
  const more = ctx.rival_count - shown.length;
  const names = more > 0 ? `${shown.join(", ")} and ${String(more)} more` : shown.join(" and ");
  const subject = `We're watching ${names}`;
  return subject.length <= SUBJECT_MAX ? subject : "Welcome to Five to Nine";
}

function copy(ctx: WelcomeContext) {
  const brief =
    ctx.first_brief_at === null
      ? "Your first ranking arrives with your weekly brief."
      : `Your first ranking arrives with your weekly brief on ${formatDate(ctx.first_brief_at, ctx.timezone, false)}.`;
  return {
    subject: subjectFor(ctx),
    lines: [
      watching(ctx),
      "Pricing changes and site breakages get their own email after our nightly read. Everything else waits for the brief.",
      brief,
    ],
  };
}

export function renderWelcome(ctx: WelcomeContext): RenderedBrief {
  const { subject, lines } = copy(ctx);
  return {
    subject,
    text: [subject, ...lines, `Open your first look: ${ctx.home_link}`, supportLineText()].join("\n\n"),
    html: emailDocument(
      subject,
      [
        `<p class="brief-muted" style="${EYEBROW}">You're in</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        ...lines.map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`),
        linkParagraph("Open your first look", ctx.home_link),
        supportLineHtml(),
      ].join(""),
      lines[0],
    ),
  };
}
