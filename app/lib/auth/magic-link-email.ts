import { escapeHtml } from "../html";

export const MAGIC_LINK_TTL_SECONDS = 5 * 60;
const TTL_MINUTES = MAGIC_LINK_TTL_SECONDS / 60;

export function magicLinkEmail(input: { email: string; url: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const email = escapeHtml(input.email);
  const url = escapeHtml(input.url);
  const subject = "Your sign-in link for Five to Nine";
  const text = [
    "Sign in to Five to Nine",
    "",
    `We sent this link to ${input.email}. It works once and expires in ${String(TTL_MINUTES)} minutes.`,
    "",
    input.url,
    "",
    "If you did not ask to sign in, ignore this email. Nothing happens until the link is used.",
  ].join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>Your sign-in link for Five to Nine</title><style>@media (prefers-color-scheme: dark){.ftn-ground{background:#14130f!important}.ftn-card{background:#1c1a15!important;border-color:#322e25!important}.ftn-ink{color:#f2efe4!important}.ftn-soft{color:#a9a294!important}.ftn-button{background:#f2efe4!important;color:#14130f!important}}</style></head><body class="ftn-ground" style="margin:0;padding:24px 12px;background:#f4f1e8;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;"><tr><td class="ftn-card" style="background:#fffdf6;border:1px solid #ddd6c6;padding:32px;font-family:'Bricolage Grotesque',ui-sans-serif,sans-serif;"><p class="ftn-ink" style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0e0d0a;">Sign in to Five to Nine</p><p class="ftn-soft" style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#55524a;">We sent this link to ${email}. It works once and expires in ${String(TTL_MINUTES)} minutes.</p><p style="margin:0 0 24px;"><a class="ftn-button" href="${url}" style="display:inline-block;background:#0e0d0a;color:#f4f1e8;padding:12px 20px;font-size:16px;font-weight:700;text-decoration:none;">Sign in</a></p><p class="ftn-soft" style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#55524a;">If the button does not work, paste this address into your browser:<br><span style="word-break:break-all;">${url}</span></p><p class="ftn-soft" style="margin:0;font-size:14px;line-height:1.5;color:#55524a;">If you did not ask to sign in, ignore this email. Nothing happens until the link is used.</p></td></tr></table></body></html>`;
  return { subject, text, html };
}
