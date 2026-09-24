import { escapeHtml } from "../../app/lib/html";

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
export const EYEBROW = `margin:0 0 8px;font-family:${MONO};font-size:12px;line-height:16px;letter-spacing:0.16em;text-transform:uppercase;font-weight:500;`;

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
    `@media (prefers-color-scheme: dark) {`,
    `.brief-page{background-color:${DARK_COLORS.page};}`,
    `.brief-card{background-color:${DARK_COLORS.card};color:${DARK_COLORS.ink};}`,
    `.brief-muted{color:${DARK_COLORS.muted};}`,
    `.brief-rule{border-top:1px solid ${DARK_COLORS.rule};}`,
    `.brief-rule img{border:1px solid ${DARK_COLORS.rule};}`,
    `.brief-card{border:1.5px solid ${DARK_COLORS.ink};}`,
    `.brief-marker{background-color:${DARK_COLORS.green};color:${COLORS.onGreen};}`,
    `.brief-strike{color:${DARK_COLORS.muted};text-decoration-color:${DARK_COLORS.red};}`,
    `}`,
    `</style>`,
  ].join("");
}

export function emailDocument(title: string, body: string): string {
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
    `<div style="padding:24px 12px;">`,
    `<div class="brief-card" style="max-width:600px;margin:0 auto;padding:24px;">`,
    `<p style="margin:0 0 20px;font-family:${FONT};font-size:17px;line-height:22px;font-weight:800;letter-spacing:-0.03em;">05<span class="brief-marker" style="padding:0 5px;">09</span></p>`,
    body,
    `</div></div>`,
    `</body>`,
    `</html>`,
  ].join("");
}
