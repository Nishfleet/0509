/**
 * Shared dark-mode-safe email shell for Gmail/Outlook.
 *
 * Forces light surfaces with explicit colors (no prefers-color-scheme).
 * Customer-facing copy in the footer must stay stable — callers compose
 * body HTML onto this skeleton; transactional mail may omit unsubscribe.
 */

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export const EMAIL_FONT_STACK = "Inter, system-ui, sans-serif";
export const EMAIL_SURFACE_BG = "#ffffff";
export const EMAIL_TEXT_PRIMARY = "#0b1220";
export const EMAIL_TEXT_MUTED = "#98a2b3";
export const EMAIL_TEXT_LINK = "#5b6577";
export const EMAIL_BORDER = "#e4e7ec";
export const EMAIL_CONTENT_MAX_WIDTH_PX = 600;

export type RenderEmailShellInput = {
  /** Inner HTML placed in the content cell (already escaped by the caller). */
  bodyHtml: string;
  /**
   * When set, footer includes an Unsubscribe link.
   * Pass null/undefined for transactional mail (password reset, verification)
   * so List-Unsubscribe is also omitted by the sender.
   */
  unsubscribeUrl?: string | null;
  /** Optional hidden preheader for inbox preview text. */
  preheader?: string | null;
  /** When false, omit the shared footer (rare; prefer null unsubscribeUrl). */
  includeFooter?: boolean;
};

/**
 * Table-based document skeleton with forced light surfaces + optional footer.
 */
export function renderEmailShell(input: RenderEmailShellInput): string {
  const includeFooter = input.includeFooter !== false;
  const preheader = input.preheader?.trim()
    ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeEmailHtml(input.preheader.trim())}</div>`
    : "";
  const footerHtml = includeFooter
    ? renderEmailFooter(input.unsubscribeUrl ?? null)
    : "";

  return `${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse; margin:0; padding:0; background-color:${EMAIL_SURFACE_BG};">
  <tr>
    <td align="center" style="background-color:${EMAIL_SURFACE_BG}; padding:24px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse; max-width:${EMAIL_CONTENT_MAX_WIDTH_PX}px; background-color:${EMAIL_SURFACE_BG}; color:${EMAIL_TEXT_PRIMARY};">
        <tr>
          <td style="font-family:${EMAIL_FONT_STACK}; background-color:${EMAIL_SURFACE_BG}; color:${EMAIL_TEXT_PRIMARY}; line-height:1.5; padding:0;">
            ${input.bodyHtml}
          </td>
        </tr>
        ${
          includeFooter
            ? `<tr>
          <td style="font-family:${EMAIL_FONT_STACK}; background-color:${EMAIL_SURFACE_BG}; color:${EMAIL_TEXT_MUTED}; padding:0;">
            ${footerHtml}
          </td>
        </tr>`
            : ""
        }
      </table>
    </td>
  </tr>
</table>`;
}

/**
 * Shared unsubscribe + support footer. Unsubscribe link is optional.
 * Copy matches the historical delivery.server appendEmailFooter wording.
 */
export function renderEmailFooter(unsubscribeUrl: string | null): string {
  const unsubscribeLink = unsubscribeUrl
    ? ` · <a href="${escapeEmailHtml(unsubscribeUrl)}" style="color: ${EMAIL_TEXT_LINK}; text-decoration: underline;">Unsubscribe</a>`
    : "";

  return `
    <hr style="margin: 28px 0 14px; border: none; border-top: 1px solid ${EMAIL_BORDER};" />
    <p style="font-family: ${EMAIL_FONT_STACK}; margin: 0; background-color: ${EMAIL_SURFACE_BG}; color: ${EMAIL_TEXT_MUTED}; font-size: 12px; line-height: 1.5;">
      Five to Nine · <a href="https://0509.io" style="color: ${EMAIL_TEXT_LINK}; text-decoration: underline;">0509.io</a> · Questions? <a href="${SUPPORT_MAILTO}" style="color: ${EMAIL_TEXT_LINK}; text-decoration: underline;">${SUPPORT_EMAIL}</a> · You're receiving this because email delivery is configured for your workspace${unsubscribeLink}
    </p>
  `;
}

/**
 * Inner content surface used by digest/alert builders before the send-time shell wrap.
 * Forces light background + primary text color for dark-mode clients.
 */
export function renderEmailContentSurface(
  innerHtml: string,
  options?: {
    color?: string;
    fontSize?: string;
    lineHeight?: string;
  },
): string {
  const color = options?.color ?? EMAIL_TEXT_PRIMARY;
  const fontSize = options?.fontSize ? ` font-size: ${options.fontSize};` : "";
  const lineHeight = options?.lineHeight ?? "1.5";

  return `<div style="font-family: ${EMAIL_FONT_STACK}; background-color: ${EMAIL_SURFACE_BG}; color: ${color};${fontSize} line-height: ${lineHeight};">${innerHtml}</div>`;
}

export function escapeEmailHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
