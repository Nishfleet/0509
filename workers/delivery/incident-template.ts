import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { formatDate } from "./brief-template";
import { EYEBROW, FONT, emailDocument } from "./email-shell";

export interface IncidentOpenContext {
  site: string;
  kind: string;
  opened_at: string;
  recheck_at: string;
  mark: string | null;
  link: string;
  timezone: string;
}

export interface IncidentFixedContext {
  site: string;
  kind: string;
  closed_at: string;
  link: string;
  timezone: string;
}

const COPY = {
  openSubject: (site: string, kind: string) => `${site} looks broken: ${kind}`,
  seen: (opened_at: string, timezone: string) => `Seen at ${formatDate(opened_at, timezone, true)}.`,
  mark: (mark: string) => `What changed: ${mark}`,
  recheck: (recheck_at: string, timezone: string) =>
    `We re-check at ${formatDate(recheck_at, timezone, true)} and email you once when it is fixed.`,
  openLink: (link: string) => `See it in Five to Nine: ${link}`,
  fixedSubject: (site: string, kind: string) => `${site} looks fixed: ${kind}`,
  fixedLine: (site: string, closed_at: string, timezone: string) =>
    `We re-checked ${site} at ${formatDate(closed_at, timezone, true)} and it looks fixed.`,
} as const;

const HEADLINE = `margin:0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.02em;`;
const BODY = `margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;`;

function linkLine(link: string): string {
  const href = escapeHtml(link);
  return `<p style="${BODY}">See it in Five to Nine: <a class="brief-ink" href="${href}">${href}</a></p>`;
}

export function renderIncidentOpen(ctx: IncidentOpenContext): RenderedBrief {
  const subject = COPY.openSubject(ctx.site, ctx.kind);
  const lines = [
    subject,
    COPY.seen(ctx.opened_at, ctx.timezone),
    ...(ctx.mark === null ? [] : [COPY.mark(ctx.mark)]),
    COPY.recheck(ctx.recheck_at, ctx.timezone),
  ];
  return {
    subject,
    text: [...lines, COPY.openLink(ctx.link)].join("\n"),
    html: emailDocument(
      subject,
      [
        `<p class="brief-muted" style="${EYEBROW}">Your site</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        ...lines.slice(1).map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`),
        linkLine(ctx.link),
      ].join(""),
    ),
  };
}

export function renderIncidentFixed(ctx: IncidentFixedContext): RenderedBrief {
  const subject = COPY.fixedSubject(ctx.site, ctx.kind);
  const line = COPY.fixedLine(ctx.site, ctx.closed_at, ctx.timezone);
  return {
    subject,
    text: `${line} ${ctx.link}`,
    html: emailDocument(
      subject,
      [
        `<p class="brief-muted" style="${EYEBROW}">Your site</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        `<p style="${BODY}">${escapeHtml(line)}</p>`,
        linkLine(ctx.link),
      ].join(""),
    ),
  };
}
