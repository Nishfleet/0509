import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "./brief-template";

export interface IncidentOpenContext {
  site: string;
  kind: string;
  opened_at: string;
  recheck_at: string;
  mark: string | null;
  link: string;
}

export interface IncidentFixedContext {
  site: string;
  kind: string;
  closed_at: string;
  link: string;
}

function utc(iso: string): string {
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

const COPY = {
  openSubject: (site: string, kind: string) => `${site} looks broken: ${kind}`,
  seen: (opened_at: string) => `Seen at ${utc(opened_at)}.`,
  mark: (mark: string) => `What changed: ${mark}`,
  recheck: (recheck_at: string) =>
    `We re-check at ${utc(recheck_at)} and email you once when it is fixed.`,
  openLink: (link: string) => `See it in Five to Nine: ${link}`,
  fixedSubject: (site: string, kind: string) => `${site} looks fixed: ${kind}`,
  fixedLine: (site: string, closed_at: string) =>
    `We re-checked ${site} at ${utc(closed_at)} and it looks fixed.`,
} as const;

export function renderIncidentOpen(ctx: IncidentOpenContext): RenderedBrief {
  const subject = COPY.openSubject(ctx.site, ctx.kind);
  const lines = [
    subject,
    COPY.seen(ctx.opened_at),
    ...(ctx.mark === null ? [] : [COPY.mark(ctx.mark)]),
    COPY.recheck(ctx.recheck_at),
  ];
  return {
    subject,
    text: [...lines, COPY.openLink(ctx.link)].join("\n"),
    html:
      lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("") +
      `<p>See it in Five to Nine: <a href="${escapeHtml(ctx.link)}">${escapeHtml(ctx.link)}</a></p>`,
  };
}

export function renderIncidentFixed(ctx: IncidentFixedContext): RenderedBrief {
  const subject = COPY.fixedSubject(ctx.site, ctx.kind);
  const line = COPY.fixedLine(ctx.site, ctx.closed_at);
  return {
    subject,
    text: `${line} ${ctx.link}`,
    html: `<p>${escapeHtml(line)} <a href="${escapeHtml(ctx.link)}">${escapeHtml(ctx.link)}</a></p>`,
  };
}
