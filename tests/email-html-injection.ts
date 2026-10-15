import { expect } from "vitest";

export const PROBE = "<img src=x onerror=1>\"'";

export const URL_PROBE = `https://x.test/${PROBE}`;

export function expectNoHtmlInjection(html: string, where: string): void {
  expect(html, `${where}: raw <img> tag`).not.toContain("<img src=x");
  expect(html, `${where}: raw onerror handler`).not.toContain("onerror=1>");
  expect(html, `${where}: raw quote break-out`).not.toContain(`1>"'`);
}
