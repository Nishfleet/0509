import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { formatDate } from "./brief-template";
import { supportLineHtml, supportLineText } from "../../app/lib/alert-footer";
import { BODY_STYLE, EYEBROW_STYLE, HEADLINE, emailDocument, linkParagraph } from "../../app/lib/email-shell";

export interface WelcomeContext {
  rivals: readonly string[];
  rival_count: number;
  first_brief_at: string | null;
  timezone: string;
  home_link: string;
}

function rivalNames(ctx: WelcomeContext): string {
  const more = ctx.rival_count - ctx.rivals.length;
  return ctx.rivals.join(", ") + (more > 0 ? ` and ${String(more)} more` : "");
}

function watching(ctx: WelcomeContext, namedInSubject: boolean): string {
  if (ctx.rival_count === 0)
    return "Add the competitors you want to keep an eye on and we'll start reading their sites.";
  if (namedInSubject) return "We read each site every night. Anything that changes is kept as a before and after.";
  return `We're watching ${rivalNames(ctx)}. Anything that changes on their sites from here is kept as a before and after.`;
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
  const subject = subjectFor(ctx);
  return {
    subject,
    lines: [
      watching(ctx, subject.startsWith("We're watching") && ctx.rivals.length <= 2),
      "A pricing change gets its own email after our nightly read, and so does a problem with your own site. Everything else waits for the brief.",
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
        `<p class="brief-muted" style="${EYEBROW_STYLE}">You're in</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        ...lines.map((line) => `<p style="${BODY_STYLE}">${escapeHtml(line)}</p>`),
        linkParagraph("Open your first look", ctx.home_link),
        supportLineHtml(),
      ].join(""),
      lines[0],
    ),
  };
}
