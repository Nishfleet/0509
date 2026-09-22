import type { BriefPayload } from "./brief-data";

import { unsubscribeUrl } from "./send";

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export function formatInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const zone = timeZone.length > 0 ? timeZone : "UTC";
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return new Intl.DateTimeFormat("en", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function movementSentence(movement: number): string {
  if (movement > 0) return `You moved up ${String(movement)}.`;
  if (movement < 0) return `You moved down ${String(Math.abs(movement))}.`;
  return "No change in rank.";
}

function deltaPhrase(count: number): string {
  if (count > 0) return `${String(count)} more`;
  if (count < 0) return `${String(Math.abs(count))} fewer`;
  return "no change";
}

function headlineLine(payload: BriefPayload): string {
  return `You're #${String(payload.headline.rank)} of ${String(payload.headline.of)} this week`;
}

export function renderBrief(input: {
  payload: BriefPayload;
  timezone: string;
  unsubscribeToken: string;
  subjectOverride: string | null;
}): RenderedMail {
  const { payload, timezone } = input;
  const headline = headlineLine(payload);
  const subject = input.subjectOverride && input.subjectOverride.length > 0 ? input.subjectOverride : headline;
  const stopUrl = unsubscribeUrl(input.unsubscribeToken);
  const lines: string[] = [headline, movementSentence(payload.headline.movement)];
  if (payload.headline.why.length > 0) lines.push(payload.headline.why);
  if (payload.quiet) lines.push("Quiet week.");

  const htmlParts: string[] = [
    `<p style="margin:0 0 12px;font-size:20px;">${escapeHtml(headline)}</p>`,
    `<p style="margin:0 0 12px;">${escapeHtml(movementSentence(payload.headline.movement))}</p>`,
  ];
  if (payload.headline.why.length > 0) {
    htmlParts.push(`<p style="margin:0 0 12px;">${escapeHtml(payload.headline.why)}</p>`);
  }
  if (payload.quiet) htmlParts.push(`<p style="margin:0 0 12px;">Quiet week.</p>`);

  if (!payload.quiet && payload.read_this_first.length > 0) {
    lines.push("Read this first");
    htmlParts.push(`<p style="margin:16px 0 8px;">Read this first</p>`);
    for (const mark of payload.read_this_first) {
      const when = formatInZone(mark.observed_at, timezone);
      lines.push(`${mark.title} (${mark.source}, ${when})`);
      lines.push(mark.link);
      const thumb = httpUrl(mark.thumbnail_url);
      const image = thumb
        ? `<br><img src="${escapeHtml(thumb)}" alt="" width="120" style="width:120px;height:auto;border:0;">`
        : "";
      const href = httpUrl(mark.link) ?? mark.link;
      htmlParts.push(
        `<p style="margin:0 0 12px;"><a href="${escapeHtml(href)}" style="color:#1d4ed8;">${escapeHtml(mark.title)}</a> (${escapeHtml(mark.source)}, ${escapeHtml(when)})${image}</p>`,
      );
    }
  }

  if (!payload.quiet) {
    for (const brand of payload.brands) {
      const line = `${brand.name}: ${brand.biggest_move} Ads ${deltaPhrase(brand.ad_delta)}. Mentions ${deltaPhrase(brand.mention_delta)}. Site changes ${String(brand.site_change_count)}.`;
      lines.push(line);
      htmlParts.push(`<p style="margin:0 0 8px;">${escapeHtml(line)}</p>`);
    }
  }

  lines.push("Your site");
  htmlParts.push(`<p style="margin:16px 0 8px;">Your site</p>`);
  if (payload.own_site.items.length === 0) {
    lines.push("Nothing broke.");
    htmlParts.push(`<p style="margin:0 0 12px;">Nothing broke.</p>`);
  } else {
    for (const item of payload.own_site.items) {
      const line = item.still_broken ? `${item.label}, still broken.` : `${item.label}, recovered.`;
      lines.push(line);
      htmlParts.push(`<p style="margin:0 0 8px;">${escapeHtml(line)}</p>`);
    }
  }

  const checked =
    payload.checked.length === 0
      ? "Checked: none recorded."
      : `Checked ${payload.checked.map((item) => `${item.source} ${String(item.count)}`).join(", ")}.`;
  lines.push(checked);
  htmlParts.push(`<p style="margin:16px 0 8px;">${escapeHtml(checked)}</p>`);
  if (payload.next_brief_at) {
    const next = `Next brief ${formatInZone(payload.next_brief_at, timezone)}.`;
    lines.push(next);
    htmlParts.push(`<p style="margin:0 0 8px;">${escapeHtml(next)}</p>`);
  }
  const stop = `Stop these emails: ${stopUrl}`;
  lines.push(stop);
  htmlParts.push(
    `<p style="margin:16px 0 0;"><a href="${escapeHtml(stopUrl)}" style="color:#1d4ed8;">${escapeHtml(stop)}</a></p>`,
  );

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>.bg{background:#ffffff;}.fg{color:#1a1a1a;}@media (prefers-color-scheme: dark){.bg{background:#111111;}.fg{color:#f5f5f5;}}</style></head><body class="bg" style="margin:0;"><table role="presentation" class="bg" width="600" style="width:100%;max-width:600px;"><tr><td class="fg" style="padding:24px;font-family:Georgia,serif;font-size:16px;line-height:1.5;">${htmlParts.join("")}</td></tr></table></body></html>`;
  return { subject, html, text: lines.join("\n") };
}
