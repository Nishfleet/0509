import { SUPPORT_ADDRESS } from "../components/footer";
import { escapeHtml } from "./html";
import { FONT, postalLine } from "./email-shell";

export const SETTINGS_LINK = "https://0509.io/app/settings";

export interface AlertFooterContext {
  unsubscribe_url: string;
  settings_link: string;
}

const FOOTER_LINE_STYLE = `margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:18px;`;

const REASON = "You get this because you watch competitors on Five to Nine.";
const TEAMMATE_REASON = "You get this because you are a member of a Five to Nine workspace.";

export function reasonLineText(teammate = false): string {
  return teammate ? TEAMMATE_REASON : REASON;
}

export function reasonLineHtml(teammate = false): string {
  return `<p class="brief-muted" style="${FOOTER_LINE_STYLE}">${escapeHtml(reasonLineText(teammate))}</p>`;
}

export function supportLineText(): string {
  return `Questions? Write to ${SUPPORT_ADDRESS}.`;
}

export function supportLineHtml(): string {
  const address = escapeHtml(SUPPORT_ADDRESS);
  return `<p class="brief-muted" style="${FOOTER_LINE_STYLE}">Questions? Write to <a class="brief-muted" href="mailto:${address}">${address}</a>.</p>`;
}

export function unsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function renderAlertFooter(ctx: AlertFooterContext): { html: string; text: string } {
  const settings = escapeHtml(ctx.settings_link);
  const unsubscribe = escapeHtml(ctx.unsubscribe_url);
  const postal = postalLine();
  return {
    html: [
      reasonLineHtml(),
      `<p class="brief-muted" style="${FOOTER_LINE_STYLE}">Choose which alerts you get in <a class="brief-muted" href="${settings}">Settings</a>.</p>`,
      `<p class="brief-muted" style="${FOOTER_LINE_STYLE}"><a class="brief-muted" href="${unsubscribe}">Unsubscribe</a></p>`,
      supportLineHtml(),
      postal?.html ?? "",
    ].join(""),
    text: [
      reasonLineText(),
      `Choose which alerts you get in Settings: ${ctx.settings_link}`,
      `Unsubscribe: ${ctx.unsubscribe_url}`,
      supportLineText(),
      ...(postal === null ? [] : [postal.text]),
    ].join("\n"),
  };
}
