import { escapeHtml } from "../../app/lib/html";
import { FONT } from "./email-shell";

export const SETTINGS_LINK = "https://0509.io/app/settings";

export interface AlertFooterContext {
  unsubscribe_url: string;
  settings_link: string;
}

const LINE = `margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:18px;`;

export function unsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function renderAlertFooter(ctx: AlertFooterContext): { html: string; text: string } {
  const settings = escapeHtml(ctx.settings_link);
  const unsubscribe = escapeHtml(ctx.unsubscribe_url);
  return {
    html: [
      `<p class="brief-muted" style="${LINE}">Choose which alerts you get in <a class="brief-muted" href="${settings}">Settings</a>.</p>`,
      `<p class="brief-muted" style="${LINE}"><a class="brief-muted" href="${unsubscribe}">Unsubscribe</a></p>`,
    ].join(""),
    text: [`Choose which alerts you get in Settings: ${ctx.settings_link}`, `Unsubscribe: ${ctx.unsubscribe_url}`].join(
      "\n",
    ),
  };
}
