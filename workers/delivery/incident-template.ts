import { formatInZone } from "./brief-template";
import { unsubscribeUrl } from "./send";

import type { RenderedMail } from "./brief-template";

export interface IncidentRenderInput {
  site: string;
  kind: string;
  mark: string;
  seenAt: string;
  timezone: string;
  link: string;
  unsubscribeToken: string;
  resolution: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function oneLine(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").trim();
}

export function renderIncident(input: IncidentRenderInput): RenderedMail {
  const site = oneLine(input.site);
  const when = formatInZone(input.seenAt, input.timezone);
  const stopUrl = unsubscribeUrl(input.unsubscribeToken);
  const stop = `Stop these emails: ${stopUrl}`;
  if (input.resolution) {
    const subject = `${site} looks fixed`;
    const line = `${site} looks fixed as of ${when}.`;
    const text = [line, stop].join("\n");
    const html = `<!DOCTYPE html><html lang="en"><body style="margin:0;"><table role="presentation" width="600" style="width:100%;max-width:600px;"><tr><td style="padding:24px;font-family:Georgia,serif;font-size:16px;line-height:1.5;"><p style="margin:0 0 12px;">${escapeHtml(line)}</p><p style="margin:0;"><a href="${escapeHtml(stopUrl)}" style="color:#1d4ed8;">${escapeHtml(stop)}</a></p></td></tr></table></body></html>`;
    return { subject, html, text };
  }
  const kind = oneLine(input.kind);
  const subject = `${site} looks broken: ${kind}`;
  const lines = [
    subject,
    oneLine(input.mark),
    `Seen ${when}.`,
    "We re-check this page on the next sweep.",
    input.link,
    stop,
  ];
  const html = `<!DOCTYPE html><html lang="en"><head><meta name="color-scheme" content="light dark"><style>.bg{background:#ffffff;}.fg{color:#1a1a1a;}@media (prefers-color-scheme: dark){.bg{background:#111111;}.fg{color:#f5f5f5;}}</style></head><body class="bg" style="margin:0;"><table role="presentation" class="bg" width="600" style="width:100%;max-width:600px;"><tr><td class="fg" style="padding:24px;font-family:Georgia,serif;font-size:16px;line-height:1.5;"><p style="margin:0 0 12px;">${escapeHtml(subject)}</p><p style="margin:0 0 12px;">${escapeHtml(oneLine(input.mark))}</p><p style="margin:0 0 12px;">Seen ${escapeHtml(when)}.</p><p style="margin:0 0 12px;">We re-check this page on the next sweep.</p><p style="margin:0 0 12px;"><a href="${escapeHtml(input.link)}" style="color:#1d4ed8;">Open the page</a></p><p style="margin:0;"><a href="${escapeHtml(stopUrl)}" style="color:#1d4ed8;">${escapeHtml(stop)}</a></p></td></tr></table></body></html>`;
  return { subject, html, text: lines.join("\n") };
}
