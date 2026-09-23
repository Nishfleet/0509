import type { BriefContext, BriefPayload, RenderedBrief } from "../../app/lib/brief-payload";

const COPY = {
  subject: (rank: number, total: number) =>
    `Your weekly brief: you're #${n(rank)} of ${n(total)} this week`,
  headline: (rank: number, total: number) => `You're #${n(rank)} of ${n(total)} this week`,
  noRank: "Add a competitor to see where you stand",
  up: (count: number) => `up ${n(count)}`,
  down: (count: number) => `down ${n(count)}`,
  same: "holding steady",
  new: "new",
  readThisFirst: "Read this first",
  nothingFirst: "Nothing this week needed reading first.",
  yourBrands: "Your tracked brands",
  ownSiteOk: "Your site looks fine.",
  ownSiteBroken: (count: number) =>
    `Your site looks broken (${count === 1 ? "1 page" : `${n(count)} pages`}):`,
  stillBroken: "still broken",
  fixed: "fixed",
  footerTitle: "What was checked",
  next: "Next brief",
  noNext: "Next brief date not set yet",
  unsubscribe: "Unsubscribe",
  noUnsubscribe: "Unsubscribe is not available right now — reply to this email and we will stop sending.",
  degraded: (count: number) =>
    `${n(count)} ${count === 1 ? "source" : "sources"} did not answer this week, so these counts are short.`,
} as const;

const COLORS = {
  page: "#f4f1e8",
  card: "#fffdf6",
  ink: "#0e0d0a",
  muted: "#55524a",
  rule: "#ddd6c6",
} as const;

const DARK_COLORS = {
  page: "#14130f",
  card: "#1c1a15",
  ink: "#f2efe4",
  muted: "#a9a294",
  rule: "#322e25",
} as const;

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

function n(value: number): string {
  return String(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_URL_SCHEMES = ["https:", "http:", "mailto:"];

function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (!SAFE_URL_SCHEMES.some((scheme) => lower.startsWith(scheme))) return null;
  return escapeHtml(trimmed);
}

function formatDate(iso: string, timezone: string, withTime: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      ...(withTime
        ? { dateStyle: "medium" as const, timeStyle: "short" as const }
        : { dateStyle: "full" as const }),
    }).format(date);
  } catch {
    return iso;
  }
}

function countPhrase(count: number, one: string, many: string): string {
  if (count === 0) return `no ${many}`;
  return count === 1 ? `1 ${one}` : `${n(count)} ${many}`;
}

function movementText(movement: number | null, isNew: boolean): string {
  if (isNew) return COPY.new;
  if (movement === null) return "no last week to compare";
  if (movement > 0) return COPY.up(movement);
  if (movement < 0) return COPY.down(Math.abs(movement));
  return COPY.same;
}

function countsSentence(checked: BriefPayload["checked"]): string {
  return [
    countPhrase(checked.mention_count, "mention", "mentions"),
    countPhrase(checked.site_change_count, "site change", "site changes"),
    countPhrase(checked.new_ad_count, "new ad", "new ads"),
  ].join(", ");
}

function thumbnailSrc(r2Key: string | null, assetBaseUrl: string | null): string | null {
  if (r2Key === null) return null;
  if (assetBaseUrl === null) return null;
  return safeUrl(`${assetBaseUrl.replace(/\/+$/, "")}/${r2Key.replace(/^\/+/, "")}`);
}

function renderHeadline(payload: BriefPayload): { html: string; text: string } {
  const { headline_rank, headline_total, headline_movement } = payload;
  if (headline_rank === null || headline_total < 2) {
    return {
      html: `<p style="margin:0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:600;">${escapeHtml(COPY.noRank)}</p>`,
      text: COPY.noRank,
    };
  }

  const movement = movementText(headline_movement, payload.headline_is_new);
  const period = `${formatDate(payload.period_start, payload.timezone, false)} – ${formatDate(payload.period_end, payload.timezone, false)}`;

  const html = [
    `<p style="margin:0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:600;">`,
    escapeHtml(COPY.headline(headline_rank, headline_total)),
    `<span class="brief-muted" style="font-weight:400;"> ${escapeHtml(movement)}</span>`,
    `</p>`,
    `<p class="brief-muted" style="margin:4px 0 0;font-family:${FONT};font-size:14px;line-height:20px;">${escapeHtml(period)}</p>`,
    `<p style="margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;">${escapeHtml(payload.why_line)}</p>`,
  ].join("");

  const text = [
    `${COPY.headline(headline_rank, headline_total)} — ${movement}`,
    period,
    payload.why_line,
  ].join("\n");

  return { html, text };
}

function renderMark(
  mark: BriefPayload["read_this_first"][number],
  payload: BriefPayload,
  assetBaseUrl: string | null,
): { html: string; text: string } {
  const label = mark.entity_name === "" ? mark.source : `${mark.entity_name} · ${mark.source}`;
  const when = formatDate(mark.observed_at, payload.timezone, true);
  const thumb = thumbnailSrc(mark.thumbnail_r2_key, assetBaseUrl);
  const title = mark.title === "" ? mark.url : mark.title;
  const href = safeUrl(mark.url);

  const html = [
    `<div class="brief-rule" style="padding:16px 0;">`,
    `<p class="brief-muted" style="margin:0;font-family:${FONT};font-size:13px;line-height:18px;">${escapeHtml(label)}</p>`,
    `<p class="brief-muted" style="margin:2px 0 0;font-family:${FONT};font-size:14px;line-height:20px;">${escapeHtml(when)}</p>`,
    `<p style="margin:6px 0 0;font-family:${FONT};font-size:16px;line-height:24px;">`,
    href === null
      ? escapeHtml(title)
      : `<a class="brief-ink" href="${href}">${escapeHtml(title)}</a>`,
    `</p>`,
    mark.before !== null && mark.after !== null
      ? `<p class="brief-muted" style="margin:6px 0 0;font-family:${FONT};font-size:14px;line-height:20px;">${escapeHtml(`${mark.before} → ${mark.after}`)}</p>`
      : "",
    thumb !== null && href !== null
      ? `<p style="margin:8px 0 0;"><a class="brief-ink" href="${href}"><img src="${thumb}" alt="screenshot thumbnail" width="${n(120)}" height="${n(90)}" style="display:block;border-radius:4px;"></a></p>`
      : "",
    `<p style="margin:8px 0 0;font-family:${FONT};font-size:14px;line-height:20px;">${escapeHtml(mark.jev_reason)}</p>`,
    `</div>`,
  ].join("");

  const text = [
    label,
    when,
    title ? `${title} — ${mark.url}` : mark.url,
    mark.before !== null && mark.after !== null ? `${mark.before} → ${mark.after}` : "",
    mark.jev_reason,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { html, text };
}

function renderReadThisFirst(
  payload: BriefPayload,
  assetBaseUrl: string | null,
): { html: string; text: string } {
  const marks = payload.read_this_first.slice(0, 3);

  const heading = (text: string) =>
    `<h2 style="margin:0 0 4px;font-family:${FONT};font-size:18px;line-height:24px;font-weight:600;">${escapeHtml(text)}</h2>`;

  if (marks.length === 0) {
    return {
      html: `${heading(COPY.readThisFirst)}<p style="margin:0;font-family:${FONT};font-size:16px;line-height:24px;">${escapeHtml(COPY.nothingFirst)}</p>`,
      text: `${COPY.readThisFirst}\n${COPY.nothingFirst}`,
    };
  }

  const html = [
    heading(COPY.readThisFirst),
    ...marks.map((mark) => renderMark(mark, payload, assetBaseUrl).html),
  ].join("");

  const rendered = marks.map((mark) => renderMark(mark, payload, assetBaseUrl));
  const text = [COPY.readThisFirst, ...rendered.map((r) => r.text)].join("\n\n");

  return { html, text };
}

function renderBrandLine(line: BriefPayload["brands"][number]): { html: string; text: string } {
  const counts = [
    countPhrase(line.ad_delta, "new ad", "new ads"),
    countPhrase(line.mention_delta, "mention", "mentions"),
    countPhrase(line.site_change_count, "site change", "site changes"),
  ];

  const rankLabel = line.rank === null ? "unranked" : `#${n(line.rank)}`;
  const movement = movementText(line.movement, line.is_new);

  const html = [
    `<div class="brief-rule" style="padding:10px 0;">`,
    `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:24px;">`,
    `<strong>${escapeHtml(line.name)}</strong>`,
    ` <span class="brief-muted">${escapeHtml(rankLabel)}, ${escapeHtml(movement)}</span>`,
    `</p>`,
    line.biggest_move !== null
      ? `<p style="margin:2px 0 0;font-family:${FONT};font-size:15px;line-height:22px;">${escapeHtml(line.biggest_move)}</p>`
      : "",
    `<p class="brief-muted" style="margin:2px 0 0;font-family:${FONT};font-size:14px;line-height:20px;">${escapeHtml(counts.join(" · "))}</p>`,
    `</div>`,
  ].join("");

  const text = [
    `${line.name} — ${rankLabel}, ${movement}`,
    line.biggest_move,
    counts.join(" · "),
  ]
    .filter((v): v is string => v !== null)
    .join("\n");

  return { html, text };
}

function renderBrands(payload: BriefPayload): { html: string; text: string } {
  const heading = (text: string) =>
    `<h2 style="margin:0 0 4px;font-family:${FONT};font-size:18px;line-height:24px;font-weight:600;">${escapeHtml(text)}</h2>`;

  if (payload.brands.length === 0) {
    return {
      html: `${heading(COPY.yourBrands)}<p style="margin:0;font-family:${FONT};font-size:16px;line-height:24px;">${escapeHtml(COPY.noRank)}</p>`,
      text: `${COPY.yourBrands}\n${COPY.noRank}`,
    };
  }

  const rendered = payload.brands.map((line) => renderBrandLine(line));

  return {
    html: heading(COPY.yourBrands) + rendered.map((r) => r.html).join(""),
    text: [COPY.yourBrands, ...rendered.map((r) => r.text)].join("\n\n"),
  };
}

function renderOwnSite(payload: BriefPayload): { html: string; text: string } {
  const { own_site } = payload;
  const body = (text: string) =>
    `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:24px;">${escapeHtml(text)}</p>`;

  if (own_site.status === "ok" || own_site.incidents.length === 0) {
    return {
      html: body(COPY.ownSiteOk),
      text: COPY.ownSiteOk,
    };
  }

  const open = own_site.incidents;
  const lines = open
    .map((incident) => {
      const when = formatDate(incident.observed_at, payload.timezone, true);
      const state = incident.is_open ? COPY.stillBroken : COPY.fixed;
      const label = incident.kind === "" ? incident.page_url : `${incident.kind} on ${incident.page_url}`;
      return `${label} — ${state} as of ${when}`;
    })
    .join("\n");

  const html = [
    body(COPY.ownSiteBroken(open.length)),
    `<p style="margin:6px 0 0;font-family:${FONT};font-size:15px;line-height:22px;">`,
    lines
      .split("\n")
      .map((line) => `<span style="display:block;">${escapeHtml(line)}</span>`)
      .join(""),
    `</p>`,
  ].join("");

  return { html, text: `${COPY.ownSiteBroken(open.length)}\n${lines}` };
}

function renderFooter(payload: BriefPayload, unsubscribeUrl: string | null): { html: string; text: string } {
  const checked = countsSentence(payload.checked);
  const sources =
    payload.checked.source_keys.length > 0 ? payload.checked.source_keys.join(", ") : "no sources answered";

  const nextAt =
    payload.next_brief_at === null
      ? COPY.noNext
      : `${COPY.next}: ${formatDate(payload.next_brief_at, payload.timezone, true)}`;

  const degraded =
    payload.checked.degraded_source_keys.length > 0
      ? ` ${COPY.degraded(payload.checked.degraded_source_keys.length)}`
      : "";

  const unsubscribeHref = unsubscribeUrl === null ? null : safeUrl(unsubscribeUrl);
  const html = [
    `<div class="brief-rule" style="padding:16px 0 0;">`,
    `<p class="brief-muted" style="margin:0;font-family:${FONT};font-size:13px;line-height:18px;">${escapeHtml(COPY.footerTitle)}</p>`,
    `<p class="brief-muted" style="margin:2px 0 0;font-family:${FONT};font-size:13px;line-height:18px;">${escapeHtml(`${checked} across ${sources}.${degraded}`)}</p>`,
    `<p class="brief-muted" style="margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:18px;">${escapeHtml(nextAt)}</p>`,
    `<p class="brief-muted" style="margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:18px;">`,
    unsubscribeHref === null
      ? escapeHtml(COPY.noUnsubscribe)
      : `<a class="brief-muted" href="${unsubscribeHref}">${escapeHtml(COPY.unsubscribe)}</a>`,
    `</p>`,
    `</div>`,
  ].join("");

  const text = [
    `${COPY.footerTitle}: ${checked} across ${sources}.${degraded}`,
    nextAt,
    unsubscribeUrl === null ? COPY.noUnsubscribe : `${COPY.unsubscribe}: ${unsubscribeUrl}`,
  ].join("\n");

  return { html, text };
}

function briefStyle(): string {
  return [
    `<style>`,
    `.brief-page{background-color:${COLORS.page};}`,
    `.brief-card{background-color:${COLORS.card};color:${COLORS.ink};}`,
    `.brief-muted{color:${COLORS.muted};}`,
    `.brief-rule{border-top:1px solid ${COLORS.rule};}`,
    `.brief-rule img{border:1px solid ${COLORS.rule};}`,
    `a.brief-ink,a.brief-muted{color:inherit;}`,
    `@media (prefers-color-scheme: dark) {`,
    `.brief-page{background-color:${DARK_COLORS.page};}`,
    `.brief-card{background-color:${DARK_COLORS.card};color:${DARK_COLORS.ink};}`,
    `.brief-muted{color:${DARK_COLORS.muted};}`,
    `.brief-rule{border-top:1px solid ${DARK_COLORS.rule};}`,
    `.brief-rule img{border:1px solid ${DARK_COLORS.rule};}`,
    `}`,
    `</style>`,
  ].join("");
}

export function renderBrief(payload: BriefPayload, context: BriefContext): RenderedBrief {
  const headline = renderHeadline(payload);
  const marks = renderReadThisFirst(payload, context.asset_base_url);
  const brands = renderBrands(payload);
  const ownSite = renderOwnSite(payload);
  const footer = renderFooter(payload, context.unsubscribe_url);

  const subject =
    payload.headline_rank !== null && payload.headline_total >= 2
      ? COPY.subject(payload.headline_rank, payload.headline_total)
      : "Your weekly brief";

  const block = (inner: string) =>
    `<div class="brief-rule" style="padding:20px 0;">${inner}</div>`;

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="color-scheme" content="light dark">`,
    briefStyle(),
    `<title>${escapeHtml(subject)}</title>`,
    `</head>`,
    `<body class="brief-page" style="margin:0;padding:0;">`,
    `<div style="padding:24px 12px;">`,
    `<div class="brief-card" style="max-width:600px;margin:0 auto;padding:24px;border-radius:8px;">`,
    headline.html,
    block(marks.html),
    block(brands.html),
    block(ownSite.html),
    footer.html,
    `</div></div>`,
    `</body>`,
    `</html>`,
  ].join("");

  const text = [
    headline.text,
    "",
    marks.text,
    "",
    brands.text,
    "",
    ownSite.text,
    "",
    footer.text,
  ].join("\n");

  return { subject, html, text };
}
