/**
 * Shared dark-mode-safe email shell for Gmail/Outlook.
 *
 * Two themes:
 * - "plain" (default): the historical white/Inter transactional shell —
 *   byte-identical to previous output (welcome, verification, billing).
 * - "case-file": the landing-page design system applied to the customer
 *   email-brief surfaces (daily/weekly digests, instant alerts, monthly
 *   recap, presence digest). Mirrors the marketing `.ld-proof-strip`
 *   case-file framing: bone ground `#F4F1E8`, ink text, signal-green
 *   `#16C47F` accents, Bricolage Grotesque 800 uppercase section heads,
 *   IBM Plex Mono for evidence/timestamps, hard offset shadows, square
 *   corners, hand-drawn dotted connectors, and honest "On record" / "Live"
 *   stamps. Emails cannot load web fonts or an external stylesheet, so the
 *   theme ships as inline styles with the design fonts' fallbacks beside
 *   them (see EMAIL_DISPLAY_FONT / EMAIL_MONO_FONT).
 *
 * Forces light surfaces with explicit colors (no prefers-color-scheme).
 */

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export const EMAIL_FONT_STACK = "Inter, system-ui, sans-serif";
export const EMAIL_SURFACE_BG = "#ffffff";
export const EMAIL_TEXT_PRIMARY = "#0b1220";
export const EMAIL_TEXT_MUTED = "#98a2b3";
export const EMAIL_TEXT_LINK = "#5b6577";
export const EMAIL_BORDER = "#e4e7ec";
export const EMAIL_CONTENT_MAX_WIDTH_PX = 600;

/**
 * Explicit heading typography. Email clients each apply their own <h1>/<h2>
 * user-agent sizes (Gmail, Outlook, and Apple Mail disagree wildly and skew
 * large), so headings must always carry an explicit size, line-height, weight,
 * and color. The slight negative tracking echoes the Geist/Vercel display feel
 * from DESIGN.md without the browser-only font.
 */
export const EMAIL_H1_STYLE =
  "margin: 0 0 12px; font-family: Inter, system-ui, sans-serif; font-size: 24px; line-height: 1.25; letter-spacing: -0.4px; font-weight: 700; color: #0b1220;";
export const EMAIL_H2_STYLE =
  "margin: 0 0 12px; font-family: Inter, system-ui, sans-serif; font-size: 17px; line-height: 1.3; letter-spacing: -0.2px; font-weight: 700; color: #0b1220;";

// ---------------------------------------------------------------------------
// Case-file palette — the email-brief theme.
//
// Mirrors the landing-page design tokens in app/app.css (:root bed)
// --bone #f4f1e8, --ink #171611, --green #16c47f, --green-ink #064d31,
// --line #e0ddd4) and the `.ld-proof-strip` / case-file framing: ink rules,
// card surfaces, hard offset shadows, square corners, dotted connectors,
// mono evidence labels. Hard-coded here because email clients do not
// support CSS custom properties (Gmail strips them).
// ---------------------------------------------------------------------------
export const EMAIL_CASE_BONE = "#f4f1e8";
export const EMAIL_CASE_CARD = "#fffdf8";
export const EMAIL_CASE_INK = "#171611";
export const EMAIL_CASE_INK_SOFT = "#55524a";
export const EMAIL_CASE_INK_FAINT = "#6e6a5e";
export const EMAIL_CASE_LINE = "#e0ddd4";
/** signal-green accent (--green on the landing page). */
export const EMAIL_CASE_GREEN = "#16c47f";
export const EMAIL_CASE_GREEN_INK = "#064d31";
export const EMAIL_CASE_GREEN_WASH = "#d9f6e8";
/** Bricolage Grotesque 800 for section heads; serif fallback when the client cannot load it. */
export const EMAIL_DISPLAY_FONT =
  '"Bricolage Grotesque", Georgia, "Times New Roman", serif';
/** IBM Plex Mono for evidence/timestamps; mono fallback. */
export const EMAIL_MONO_FONT =
  '"IBM Plex Mono", Consolas, "Courier New", monospace';

export const EMAIL_CASE_SHADOW = "4px 4px 0 rgba(23, 22, 17, 0.14)";

/** Case-file card: card surface, ink rule, square corners, hard offset shadow. */
export const EMAIL_CASE_CARD_STYLE =
  `margin: 0 0 18px; padding: 14px 16px; border: 1.5px solid ${EMAIL_CASE_INK}; border-radius: 0; background-color: ${EMAIL_CASE_CARD}; box-shadow: ${EMAIL_CASE_SHADOW};`;

/** Case-file display head: Bricolage 800 UPPERCASE for section heads. */
export const EMAIL_CASE_DISPLAY_STYLE =
  `margin: 0 0 12px; font-family: ${EMAIL_DISPLAY_FONT}; font-size: 19px; line-height: 1.25; font-weight: 800; letter-spacing: -0.2px; text-transform: uppercase; color: ${EMAIL_CASE_INK};`;

/** Case-file H1 for brief headlines. */
export const EMAIL_CASE_H1_STYLE =
  `margin: 0 0 12px; font-family: ${EMAIL_DISPLAY_FONT}; font-size: 25px; line-height: 1.24; font-weight: 800; letter-spacing: -0.2px; color: ${EMAIL_CASE_INK};`;

/** Case-file eyebrow/kicker: mono uppercase, ink. */
export const EMAIL_CASE_EYEBROW_STYLE =
  `margin: 0 0 8px; font-family: ${EMAIL_MONO_FONT}; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: ${EMAIL_CASE_INK};`;

/** Case-file meta/evidence line: mono, faint ink. */
export const EMAIL_CASE_META_STYLE =
  `margin: 0 0 6px; font-family: ${EMAIL_MONO_FONT}; font-size: 11px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK_FAINT};`;

/** Case-file primary CTA: ink button, square corners, signal-green hard shadow. */
export const EMAIL_CASE_BUTTON_STYLE =
  `display: inline-block; background-color: ${EMAIL_CASE_INK}; color: ${EMAIL_CASE_BONE}; text-decoration: none; padding: 13px 20px; font-family: ${EMAIL_MONO_FONT}; font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; border: 1.5px solid ${EMAIL_CASE_INK}; box-shadow: 3px 3px 0 ${EMAIL_CASE_GREEN};`;

export type EmailShellTheme = "plain" | "case-file";

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
  /**
   * "plain" (default) ships the historical white shell; "case-file" wraps
   * the body in the bone/ink/signal-green case-file frame (digests, instant
   * alerts, monthly recap, presence digest).
   */
  theme?: EmailShellTheme;
};

/**
 * Table-based document skeleton with forced light surfaces + optional footer.
 * The "case-file" theme adds the ink header band and the mono
 * proof-strip footer ("No proof, no claim.") that make the email brief read
 * as the same case-file system as the landing page's `.ld-proof-strip`.
 */
export function renderEmailShell(input: RenderEmailShellInput): string {
  if (input.theme === "case-file") {
    return renderCaseFileEmailShell(input);
  }
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
 * Case-file email shell (email-brief theme). Bone ground, card content cell,
 * ink header band with the signal-green live dot (the `.ld-proof-strip-head`
 * treatment), square corners, hard offset shadow, mono uppercase footer
 * ("No proof, no claim." — the honest-labelling voice carried into email).
 * Fonts declare Bricolage Grotesque / IBM Plex Mono first so capable clients
 * render the design system; others fall back beside them.
 */
function renderCaseFileEmailShell(input: RenderEmailShellInput): string {
  const includeFooter = input.includeFooter !== false;
  const preheader = input.preheader?.trim()
    ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeEmailHtml(input.preheader.trim())}</div>`
    : "";
  const unsubscribe = input.unsubscribeUrl?.trim()
    ? ` · <a href="${escapeEmailHtml(input.unsubscribeUrl.trim())}" style="color: ${EMAIL_CASE_INK_FAINT}; text-decoration: underline;">Unsubscribe</a>`
    : "";

  return `${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse; margin:0; padding:0; background-color:${EMAIL_CASE_BONE};">
  <tr>
    <td align="center" style="background-color:${EMAIL_CASE_BONE}; padding:20px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse; max-width:${EMAIL_CONTENT_MAX_WIDTH_PX}px; background-color:${EMAIL_CASE_CARD}; border:1.5px solid ${EMAIL_CASE_INK}; box-shadow:${EMAIL_CASE_SHADOW};">
        <tr>
          <td style="background-color:${EMAIL_CASE_INK}; padding:9px 16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
              <tr>
                <td style="font-family:${EMAIL_MONO_FONT}; font-size:11px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${EMAIL_CASE_BONE};">
                  <span style="display:inline-block; width:8px; height:8px; background-color:${EMAIL_CASE_GREEN}; margin-right:8px; vertical-align:middle;"></span>Five to Nine
                </td>
                <td align="right" style="font-family:${EMAIL_MONO_FONT}; font-size:10px; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; color:${EMAIL_CASE_INK_FAINT};">
                  proof backed
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="font-family:${EMAIL_FONT_STACK}; background-color:${EMAIL_CASE_CARD}; color:${EMAIL_CASE_INK}; line-height:1.5; padding:20px 20px 8px;">
            ${input.bodyHtml}
          </td>
        </tr>
        ${
          includeFooter
            ? `<tr>
          <td style="font-family:${EMAIL_FONT_STACK}; background-color:${EMAIL_CASE_CARD}; color:${EMAIL_CASE_INK_FAINT}; padding:0;">
            ${renderCaseFileEmailFooter(input.unsubscribeUrl ?? null)}
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
 * Case-file footer: the proof strip's honesty foot carried into email —
 * "Every row links to the same public page. No proof, no claim." — plus the
 * standard support/unsubscribe links in mono.
 */
function renderCaseFileEmailFooter(unsubscribeUrl: string | null): string {
  const unsubscribeLink = unsubscribeUrl
    ? ` · <a href="${escapeEmailHtml(unsubscribeUrl)}" style="color: ${EMAIL_CASE_INK_FAINT}; text-decoration: underline;">Unsubscribe</a>`
    : "";

  return `
    <div style="margin: 8px 20px 16px; border-top: 1px dotted ${EMAIL_CASE_LINE}; padding-top: 12px;">
      <p style="font-family: ${EMAIL_MONO_FONT}; margin: 0 0 6px; color: ${EMAIL_CASE_INK}; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">
        No proof, no claim.
      </p>
      <p style="font-family: ${EMAIL_MONO_FONT}; margin: 0; color: ${EMAIL_CASE_INK_FAINT}; font-size: 11px; line-height: 1.6;">
        Five to Nine · <a href="https://0509.io" style="color: ${EMAIL_CASE_INK_FAINT}; text-decoration: underline;">0509.io</a> · <a href="https://0509.io/capture-rules" style="color: ${EMAIL_CASE_INK_FAINT}; text-decoration: underline;">What we refuse to alert on</a> · Questions? <a href="${SUPPORT_MAILTO}" style="color: ${EMAIL_CASE_INK_FAINT}; text-decoration: underline;">${SUPPORT_EMAIL}</a> · You're receiving this because email delivery is configured for your workspace${unsubscribeLink}
      </p>
    </div>
  `;
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
 * Inner content surface used by the email-brief builders (digest/alert)
 * before the send-time shell wrap. Uses the case-file card surface so the
 * brief body sits on the same card colour as the shell; forces light
 * background + primary text color for dark-mode clients.
 */
export function renderEmailContentSurface(
  innerHtml: string,
  options?: {
    color?: string;
    fontSize?: string;
    lineHeight?: string;
  },
): string {
  const color = options?.color ?? EMAIL_CASE_INK;
  const fontSize = options?.fontSize ? ` font-size: ${options.fontSize};` : "";
  const lineHeight = options?.lineHeight ?? "1.5";

  return `<div style="font-family: ${EMAIL_FONT_STACK}; background-color: ${EMAIL_CASE_CARD}; color: ${color};${fontSize} line-height: ${lineHeight};">${innerHtml}</div>`;
}

// ---------------------------------------------------------------------------
// Case-file primitives for email-brief builders.
// ---------------------------------------------------------------------------

export type EmailCaseStampTone = "live" | "record" | "check" | "unavailable";

/**
 * Honesty stamp chip ("Live" / "On record" / "Check-spotted" / ...).
 * Mirrors the landing page `.ld-stamp` treatment: mono uppercase, square
 * corners, signal-green for live evidence, ink for stored-record states.
 * Used to give every change row the "On record" / "Live" honesty label the
 * landing proof strip carries.
 */
export function renderEmailCaseStamp(
  label: string,
  tone: EmailCaseStampTone = "record",
): string {
  const palette: Record<
    EmailCaseStampTone,
    { border: string; color: string; bg: string }
  > = {
    live: {
      border: EMAIL_CASE_GREEN_INK,
      color: EMAIL_CASE_GREEN_INK,
      bg: EMAIL_CASE_GREEN_WASH,
    },
    record: {
      border: EMAIL_CASE_INK,
      color: EMAIL_CASE_INK,
      bg: EMAIL_CASE_CARD,
    },
    check: {
      border: EMAIL_CASE_INK,
      color: EMAIL_CASE_INK,
      bg: EMAIL_CASE_BONE,
    },
    unavailable: {
      border: EMAIL_CASE_LINE,
      color: EMAIL_CASE_INK_FAINT,
      bg: EMAIL_CASE_BONE,
    },
  };
  const p = palette[tone];
  return `<span style="display:inline-block; font-family:${EMAIL_MONO_FONT}; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; padding:3px 8px; border:1px solid ${p.border}; border-radius:0; color:${p.color}; background-color:${p.bg};">${escapeEmailHtml(label)}</span>`;
}

/**
 * Proof-trail block: mono rows separated by hand-drawn dotted connectors
 * (the `.ld-proof-trail` treatment). Each row pairs a green-ink signal label
 * with a faint-ink value. `link` renders the value as an anchor so change
 * rows can carry their public source link.
 */
export function renderEmailProofTrail(
  rows: Array<{
    label: string;
    value: string;
    link?: string | null;
  }>,
): string {
  if (rows.length === 0) {
    return "";
  }
  const html = rows
    .map((row, index) => {
      const dotted =
        index < rows.length - 1
          ? `; border-bottom: 1px dotted ${EMAIL_CASE_LINE}`
          : "";
      const value = row.link
        ? `<a href="${escapeEmailHtml(row.link)}" style="color: ${EMAIL_CASE_INK_FAINT}; text-decoration: underline;">${escapeEmailHtml(row.value)}</a>`
        : `<span style="color: ${EMAIL_CASE_INK_FAINT};">${escapeEmailHtml(row.value)}</span>`;
      return `<p style="margin: 0; padding: 6px 0; font-family:${EMAIL_MONO_FONT}; font-size: 11px; letter-spacing: 0.04em; color: ${EMAIL_CASE_INK_SOFT};${dotted}">${escapeEmailHtml(row.label)} ${value}</p>`;
    })
    .join("");
  return `<div style="margin: 0 0 12px;">${html}</div>`;
}

export function escapeEmailHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}