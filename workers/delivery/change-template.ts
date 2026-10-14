import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import type { ChangeMark } from "../../app/lib/site-change";
import { neutralizeBareUrls } from "../../app/lib/slack-webhook";
import { renderAlertFooter, type AlertFooterContext } from "./alert-footer";
import { formatDate } from "./brief-template";
import { EYEBROW, FONT, emailDocument } from "./email-shell";

export interface ChangeContext extends AlertFooterContext {
  headline: string;
  observed_at: string;
  mark: ChangeMark | null;
  link: string;
  timezone: string;
}

const HEADLINE = `margin:0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.02em;`;
const BODY = `margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;`;

const SUBJECT_MAX = 78;
const SIDE_MAX = 30;
const OPEN = "See the before and after in Five to Nine";

function oneLine(value: string | null): string | null {
  const flat =
    value
      ?.replace(/\s+/g, " ")
      .replace(/[\p{Cf}\p{Cc}]/gu, "")
      .trim() ?? "";
  return flat === "" || flat.length > SIDE_MAX ? null : flat;
}

function subjectFor(headline: string, mark: ChangeMark | null): string {
  const before = oneLine(mark?.removed ?? null);
  const after = oneLine(mark?.added ?? null);
  if (before === null || after === null) return headline;
  const subject = `${headline}: ${before} → ${after}`;
  return subject.length <= SUBJECT_MAX ? subject : headline;
}

function markLines(mark: ChangeMark | null): string[] {
  if (mark === null) return [];
  return [
    ...(mark.removed === null ? [] : [`Before: ${neutralizeBareUrls(mark.removed)}`]),
    ...(mark.added === null ? [] : [`After: ${neutralizeBareUrls(mark.added)}`]),
  ];
}

export interface ChangeOverflowContext extends AlertFooterContext {
  cap: number;
  link: string;
}

function paragraphs(lines: readonly string[]): string {
  return lines.map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`).join("");
}

export function renderChangeOverflow(ctx: ChangeOverflowContext): RenderedBrief {
  const subject = `More rivals changed price or plan today`;
  const lines = [
    `You have had ${String(ctx.cap)} price or plan emails today, so we stopped there.`,
    `Every change is still in Alerts and in your Monday brief.`,
  ];
  const footer = renderAlertFooter(ctx);
  const href = escapeHtml(ctx.link);
  return {
    subject,
    text: [subject, ...lines, `See them in Five to Nine: ${ctx.link}`, footer.text].join("\n"),
    html: emailDocument(
      subject,
      [
        `<p class="brief-muted" style="${EYEBROW}">Price or plan changes</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        paragraphs(lines),
        `<p style="${BODY}">See them in Five to Nine: <a class="brief-ink" href="${href}">${href}</a></p>`,
        footer.html,
      ].join(""),
      lines[0],
    ),
  };
}

export function renderChange(ctx: ChangeContext): RenderedBrief {
  const seen = `Seen at ${formatDate(ctx.observed_at, ctx.timezone, true)}.`;
  const lines = [...markLines(ctx.mark), seen];
  const href = escapeHtml(ctx.link);
  const footer = renderAlertFooter(ctx);
  return {
    subject: subjectFor(ctx.headline, ctx.mark),
    text: [ctx.headline, ...lines, `${OPEN}: ${ctx.link}`, footer.text].join("\n"),
    html: emailDocument(
      ctx.headline,
      [
        `<p class="brief-muted" style="${EYEBROW}">Price or plan change</p>`,
        `<p style="${HEADLINE}">${escapeHtml(ctx.headline)}</p>`,
        paragraphs(lines),
        `<p style="${BODY}"><a class="brief-ink" href="${href}">${OPEN}</a></p>`,
        footer.html,
      ].join(""),
      lines.join(" "),
    ),
  };
}
