import { expect, test } from "./test";
import { lifecycleEmails } from "../tests/delivery/email-fixtures";

const MIN_CONTRAST = 4.5;
const SCHEMES = ["light", "dark"] as const;

interface Finding {
  readonly text: string;
  readonly ratio: number;
}

function findings(minimum: number): { overflow: number; low: Finding[] } {
  const channels = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
  const luminance = ([r, g, b]: number[]): number => {
    const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const backgroundOf = (element: Element | null): number[] => {
    for (let node = element; node !== null; node = node.parentElement) {
      const [r, g, b, a = 1] = channels(getComputedStyle(node).backgroundColor);
      if (a > 0.99) return [r, g, b];
    }
    return [255, 255, 255];
  };
  const low: Finding[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? "").trim();
    const element = node.parentElement;
    if (text === "" || element === null) continue;
    if (element.closest("title,style") !== null) continue;
    if (element.getClientRects().length === 0 || getComputedStyle(element).display === "none") continue;
    if (element.closest("[style*='display:none']") !== null) continue;
    const fg = luminance(channels(getComputedStyle(element).color));
    const bg = luminance(backgroundOf(element));
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    if (ratio < minimum) low.push({ text: text.slice(0, 40), ratio: Math.round(ratio * 100) / 100 });
  }
  return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, low };
}

for (const email of lifecycleEmails()) {
  test(`${email.name} draws without sideways scroll and stays readable in light and dark`, async ({ page }) => {
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setContent(email.html);
      const result = await page.evaluate(findings, MIN_CONTRAST);
      expect(result.overflow, `${scheme}: sideways scroll`).toBeLessThanOrEqual(0);
      expect(result.low, `${scheme}: text under ${String(MIN_CONTRAST)}:1`).toEqual([]);
    }
  });
}
