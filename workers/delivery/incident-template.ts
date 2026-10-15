import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { renderAlertFooter, type AlertFooterContext } from "../../app/lib/alert-footer";
import { formatDate } from "./brief-template";
import { BODY_STYLE, EYEBROW_STYLE, HEADLINE, emailDocument, linkParagraph } from "../../app/lib/email-shell";

export interface IncidentOpenContext extends AlertFooterContext {
  site: string;
  kind: string;
  opened_at: string;
  recheck_at: string;
  mark: string | null;
  link: string;
  timezone: string;
}

export interface IncidentFixedContext extends AlertFooterContext {
  site: string;
  kind: string;
  closed_at: string;
  link: string;
  timezone: string;
}

const GENERIC_KIND = "breakage";

function kindTail(kind: string): string {
  return kind === GENERIC_KIND ? "" : `: ${kind}`;
}

const COPY = {
  openSubject: (site: string, kind: string) => `${site} looks broken${kindTail(kind)}`,
  seen: (opened_at: string, timezone: string) => `Seen at ${formatDate(opened_at, timezone, true)}.`,
  mark: (mark: string) => `What we saw: ${mark}`,
  recheck: (recheck_at: string, timezone: string) =>
    `We re-check at ${formatDate(recheck_at, timezone, true)} and email you once when it is fixed.`,
  openLink: (link: string) => `See it in Five to Nine: ${link}`,
  fixedSubject: (site: string, kind: string) => `${site} looks fixed${kindTail(kind)}`,
  fixedLine: (site: string, closed_at: string, timezone: string) =>
    `We re-checked ${site} at ${formatDate(closed_at, timezone, true)} and it looks fixed.`,
} as const;

function linkLine(link: string): string {
  return linkParagraph("See it in Five to Nine", link);
}

export function renderIncidentOpen(ctx: IncidentOpenContext): RenderedBrief {
  const subject = COPY.openSubject(ctx.site, ctx.kind);
  const lines = [
    subject,
    COPY.seen(ctx.opened_at, ctx.timezone),
    ...(ctx.mark === null ? [] : [COPY.mark(ctx.mark)]),
    COPY.recheck(ctx.recheck_at, ctx.timezone),
  ];
  const footer = renderAlertFooter(ctx);
  return {
    subject,
    text: [...lines, COPY.openLink(ctx.link), footer.text].join("\n\n"),
    html: emailDocument(
      subject,
      [
        `<p class="brief-muted" style="${EYEBROW_STYLE}">Your site</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        ...lines.slice(1).map((line) => `<p style="${BODY_STYLE}">${escapeHtml(line)}</p>`),
        linkLine(ctx.link),
        footer.html,
      ].join(""),
      lines.slice(1).join(" "),
    ),
  };
}

export function renderIncidentFixed(ctx: IncidentFixedContext): RenderedBrief {
  const subject = COPY.fixedSubject(ctx.site, ctx.kind);
  const line = COPY.fixedLine(ctx.site, ctx.closed_at, ctx.timezone);
  const footer = renderAlertFooter(ctx);
  return {
    subject,
    text: [subject, line, COPY.openLink(ctx.link), footer.text].join("\n\n"),
    html: emailDocument(
      subject,
      [
        `<p class="brief-muted" style="${EYEBROW_STYLE}">Your site</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        `<p style="${BODY_STYLE}">${escapeHtml(line)}</p>`,
        linkLine(ctx.link),
        footer.html,
      ].join(""),
      line,
    ),
  };
}
