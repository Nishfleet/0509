import { SUPPORT_ADDRESS } from "../components/footer";
import { escapeHtml } from "./html";
import { preheaderHtml } from "./preheader";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DARK_STYLE =
  "@media (prefers-color-scheme: dark){.ftn-ground{background:#14130f!important}.ftn-card{background:#1c1a15!important;border-color:#322e25!important}.ftn-ink{color:#f2efe4!important}.ftn-soft{color:#a9a294!important}.ftn-button{background:#f2efe4!important;color:#14130f!important}.ftn-mark{background:#2ee59c!important}}";

export interface LinkEmail {
  readonly subject: string;
  readonly headline: string;
  readonly line: string;
  readonly button: string;
  readonly url: string;
  readonly ignore: string;
  readonly preheader: string;
}

export function linkEmailText(input: LinkEmail): string {
  return [
    input.headline,
    "",
    input.line,
    "",
    input.url,
    "",
    input.ignore,
    "",
    `Questions? Write to ${SUPPORT_ADDRESS}.`,
  ].join("\n");
}

export function linkEmailHtml(input: LinkEmail): string {
  const url = escapeHtml(input.url);
  const support = escapeHtml(SUPPORT_ADDRESS);
  const soft = (size: number, bottom: number) =>
    `class="ftn-soft" style="margin:0 0 ${String(bottom)}px;font-size:${String(size)}px;line-height:1.5;color:#55524a;"`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(input.subject)}</title><style>${DARK_STYLE}</style></head><body class="ftn-ground" style="margin:0;padding:24px 12px;background:#f4f1e8;">${preheaderHtml(input.preheader)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;"><tr><td class="ftn-card" style="background:#fffdf6;border:1px solid #ddd6c6;padding:32px;font-family:${FONT};"><p class="ftn-ink" style="margin:0 0 20px;font-size:17px;line-height:22px;font-weight:800;letter-spacing:-0.03em;color:#0e0d0a;">05<span class="ftn-mark" style="background:#16c47f;padding:0 5px;color:#0e0d0a;">09</span></p><p class="ftn-ink" style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0e0d0a;">${escapeHtml(input.headline)}</p><p ${soft(16, 24)}>${escapeHtml(input.line)}</p><p style="margin:0 0 24px;"><a class="ftn-button" href="${url}" style="display:inline-block;background:#0e0d0a;color:#f4f1e8;padding:12px 20px;font-size:16px;font-weight:700;text-decoration:none;">${escapeHtml(input.button)}</a></p><p ${soft(14, 16)}>If the button does not work, paste this address into your browser:<br><span style="word-break:break-all;">${url}</span></p><p ${soft(14, 16)}>${escapeHtml(input.ignore)}</p><p ${soft(14, 0)}>Questions? Write to <a href="mailto:${support}" style="color:inherit;">${support}</a>.</p></td></tr></table></body></html>`;
}
