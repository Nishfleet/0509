import { escapeHtml } from "./html";
import { normaliseSubject } from "./identity/normalise";
import { preheaderHtml } from "./preheader";

const COLORS = {
  page: "#f4f1e8",
  card: "#fffdf6",
  ink: "#0e0d0a",
  muted: "#55524a",
  rule: "#ddd6c6",
  green: "#16c47f",
  red: "#e0442c",
  onGreen: "#0e0d0a",
} as const;

const DARK_COLORS = {
  page: "#14130f",
  card: "#1c1a15",
  ink: "#f2efe4",
  muted: "#a9a294",
  rule: "#322e25",
  green: "#2ee59c",
  red: "#ff7a63",
} as const;

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
export const EYEBROW_STYLE = `margin:0 0 8px;font-family:${MONO};font-size:12px;line-height:16px;letter-spacing:0.16em;text-transform:uppercase;font-weight:500;`;

export const HEADLINE = `margin:0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.02em;`;
export const BODY_STYLE = `margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;`;

const BUTTON = `display:inline-block;padding:12px 20px;border-radius:6px;font-weight:700;text-decoration:none;`;

export function linkParagraph(label: string, link: string): string {
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;"><tr>`,
    `<td class="brief-button" bgcolor="${COLORS.green}" style="border-radius:6px;background-color:${COLORS.green};">`,
    `<a class="brief-button" style="${BUTTON}" href="${escapeHtml(link)}">${escapeHtml(label)}</a>`,
    `</td></tr></table>`,
  ].join("");
}

export const POSTAL_ADDRESS: string | null = null;

export function postalLine(address: string | null = POSTAL_ADDRESS): { html: string; text: string } | null {
  if (address === null) return null;
  const line = `Five to Nine, ${address}`;
  return {
    html: `<p class="brief-muted" style="margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:18px;">${escapeHtml(line)}</p>`,
    text: line,
  };
}

function emailStyle(): string {
  return [
    `<style>`,
    `.brief-page{background-color:${COLORS.page};}`,
    `.brief-card{background-color:${COLORS.card};color:${COLORS.ink};}`,
    `.brief-muted{color:${COLORS.muted};}`,
    `.brief-rule{border-top:1px solid ${COLORS.rule};}`,
    `.brief-rule img{border:1px solid ${COLORS.rule};}`,
    `.brief-card{border:1.5px solid ${COLORS.ink};}`,
    `.brief-marker{background-color:${COLORS.green};color:${COLORS.onGreen};}`,
    `.brief-strike{color:${COLORS.muted};text-decoration-color:${COLORS.red};}`,
    `a.brief-ink,a.brief-muted{color:inherit;}`,
    `a.brief-button,td.brief-button{background-color:${COLORS.green};color:${COLORS.onGreen};}`,
    `@media (prefers-color-scheme: dark) {`,
    `.brief-page{background-color:${DARK_COLORS.page};}`,
    `.brief-card{background-color:${DARK_COLORS.card};color:${DARK_COLORS.ink};}`,
    `.brief-muted{color:${DARK_COLORS.muted};}`,
    `.brief-rule{border-top:1px solid ${DARK_COLORS.rule};}`,
    `.brief-rule img{border:1px solid ${DARK_COLORS.rule};}`,
    `.brief-card{border:1.5px solid ${DARK_COLORS.ink};}`,
    `.brief-marker{background-color:${DARK_COLORS.green};color:${COLORS.onGreen};}`,
    `.brief-strike{color:${DARK_COLORS.muted};text-decoration-color:${DARK_COLORS.red};}`,
    `a.brief-button,td.brief-button{background-color:${DARK_COLORS.green};color:${COLORS.onGreen};}`,
    `}`,
    `</style>`,
  ].join("");
}

export function emailDocument(title: string, body: string, preheader = ""): string {
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="color-scheme" content="light dark">`,
    emailStyle(),
    `<title>${escapeHtml(title)}</title>`,
    `</head>`,
    `<body class="brief-page" style="margin:0;padding:0;">`,
    preheaderHtml(preheader),
    `<div style="padding:24px 12px;">`,
    `<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;"><tr>`,
    `<td class="brief-card" style="padding:24px;overflow-wrap:anywhere;">`,
    `<p style="margin:0 0 20px;font-family:${FONT};font-size:17px;line-height:22px;font-weight:800;letter-spacing:-0.03em;">05<span class="brief-marker" style="padding:0 5px;">09</span></p>`,
    body,
    `</td></tr></table>`,
    `</div>`,
    `</body>`,
    `</html>`,
  ].join("");
}

export function siteName(url: string): string {
  const result = normaliseSubject(url);
  if (result.ok && result.subject.kind === "domain") return result.subject.registrable;
  const bare = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "");
  return bare.split(/[/?#]/)[0] ?? bare;
}
