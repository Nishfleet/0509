import type { RenderedBrief } from "../../app/lib/brief-payload";
import { clip } from "../../app/lib/brief-subject";
import { escapeHtml } from "../../app/lib/html";
import { renderAlertFooter, type AlertFooterContext } from "../../app/lib/alert-footer";
import { BODY_STYLE, EYEBROW_STYLE, HEADLINE, emailDocument, linkParagraph } from "../../app/lib/email-shell";

export interface RecapContext {
  change_count: number;
  latest: { rival: string; what: string } | null;
  standing: readonly { rival: string; lines: readonly string[] }[];
  link: string;
  footer: AlertFooterContext;
}

const CAUGHT_SUBJECT = "What Five to Nine has caught so far";
const STANDING_SUBJECT = "Where your competitors stand today";
const OPEN = "See everything in Alerts";
const SUBJECT_MAX = 70;
const RIVAL_MAX = 40;
const WHAT_MAX = 120;

function subjectFor(ctx: RecapContext): string {
  if (ctx.change_count === 0) return STANDING_SUBJECT;
  const noun = ctx.change_count === 1 ? "change" : "changes";
  const counted = `${String(ctx.change_count)} competitor ${noun} caught so far`;
  if (ctx.latest === null) return counted;
  const subject = `${counted}, latest: ${clip(ctx.latest.rival, RIVAL_MAX)}`;
  return subject.length <= SUBJECT_MAX ? subject : counted;
}

function standingLines(ctx: RecapContext): string[] {
  return [
    "Nothing has changed on their sites yet. Here is what we know about each.",
    ...ctx.standing.map((entry) => [clip(entry.rival, RIVAL_MAX), ...entry.lines].join("\n")),
  ];
}

function lines(ctx: RecapContext): string[] {
  if (ctx.change_count === 0) return standingLines(ctx);
  const noun = ctx.change_count === 1 ? "change" : "changes";
  const counted = `In your first days we've caught ${String(ctx.change_count)} ${noun} across your competitors.`;
  return ctx.latest === null
    ? [counted]
    : [
        counted,
        `Most recent: ${clip(ctx.latest.rival, RIVAL_MAX)}, ${clip(ctx.latest.what, WHAT_MAX)}`,
        "Each one is kept as a before and after.",
      ];
}

export function renderRecap(ctx: RecapContext): RenderedBrief {
  const body = lines(ctx);
  const heading = ctx.change_count === 0 ? STANDING_SUBJECT : CAUGHT_SUBJECT;
  const footer = renderAlertFooter(ctx.footer);
  return {
    subject: subjectFor(ctx),
    text: [heading, ...body, `${OPEN}: ${ctx.link}`, footer.text].join("\n\n"),
    html: emailDocument(
      heading,
      [
        `<p class="brief-muted" style="${EYEBROW_STYLE}">So far</p>`,
        `<p style="${HEADLINE}">${escapeHtml(heading)}</p>`,
        ...body.map((line) => `<p style="${BODY_STYLE}">${escapeHtml(line)}</p>`),
        linkParagraph(OPEN, ctx.link),
        footer.html,
      ].join(""),
      ctx.change_count === 0 ? body[0] : (body[1] ?? body[0]),
    ),
  };
}
