import { expect } from "vitest";

/**
 * 0509#7020: the email templates escape about 50 interpolation sites by hand.
 * #4618 and #6523 guard the escaper itself; what was missing is a per-template
 * sweep proving no site forgot to call it. These are the shared pieces every
 * template's table test plants in one string field at a time.
 */

// The probe carries the three break-out shapes at once: a raw tag
// (<img src=x), an event handler (onerror=1>) and the quote-apostrophe pair
// that walks out of a double-quoted attribute. escapeHtml turns all three
// into inert text, so any of them appearing raw means a missed call.
export const PROBE = "<img src=x onerror=1>\"'";

// The same payload behind an allowlisted scheme, for fields that pass through
// the SAFE_URL_SCHEMES gate (safeUrl) before they reach the html.
export const URL_PROBE = `https://x.test/${PROBE}`;

// The rendered html must hold none of the probe's three shapes unescaped.
// `where` names the payload field, so a failure says which escape is missing.
export function expectNoHtmlInjection(html: string, where: string): void {
  expect(html, `${where}: raw <img> tag`).not.toContain("<img src=x");
  expect(html, `${where}: raw onerror handler`).not.toContain("onerror=1>");
  expect(html, `${where}: raw quote break-out`).not.toContain(`1>"'`);
}
