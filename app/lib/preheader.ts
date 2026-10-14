import { escapeHtml } from "./html";

const PREHEADER_STYLE =
  "display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;";
const PREHEADER_FILLER = "&#847;&zwnj;&nbsp;".repeat(60);

export function preheaderHtml(preheader: string): string {
  return preheader === "" ? "" : `<div style="${PREHEADER_STYLE}">${escapeHtml(preheader)}${PREHEADER_FILLER}</div>`;
}
