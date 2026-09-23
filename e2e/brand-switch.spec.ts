import { expect, test, type Page } from "@playwright/test";

import { ON_CONSEQUENCE } from "../app/components/brand-switch";

const COLOR = {
  light: {
    on: "rgb(22, 196, 127)",
    you: "rgb(217, 246, 232)",
    off: "rgb(255, 253, 246)",
    line: "rgb(221, 214, 198)",
    faint: "rgb(142, 136, 120)",
  },
  dark: {
    on: "rgb(46, 229, 156)",
    you: "rgb(16, 40, 31)",
    off: "rgb(28, 26, 21)",
    line: "rgb(50, 46, 37)",
    faint: "rgb(123, 117, 104)",
  },
} as const;

async function thumbIsRight(page: Page, state: "on" | "off" | "you"): Promise<boolean> {
  const track = page.locator(`[data-state="${state}"] [data-slot="track"]`);
  const thumb = page.locator(`[data-state="${state}"] [data-slot="thumb"]`);
  const trackBox = await track.boundingBox();
  const thumbBox = await thumb.boundingBox();
  if (trackBox === null || thumbBox === null) throw new Error(`no box for ${state}`);
  const thumbCenter = thumbBox.x + thumbBox.width / 2;
  const mid = trackBox.x + trackBox.width / 2;
  return thumbCenter > mid;
}

test("tab reaches the per-brand switch and space toggles it", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const width = testInfo.project.use.viewport?.width === 390 ? "390" : "1440";

  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const response = await page.goto("/design/brand-switch");
    expect(response?.status()).toBe(200);

    const kindred = page.getByRole("switch", { name: "Kindred" });
    const casetta = page.getByRole("switch", { name: "Casetta" });
    const you = page.getByRole("switch", { name: "Loopwell" });

    await expect(kindred).toHaveAttribute("aria-checked", "true");
    await expect(kindred).toBeEnabled();
    await expect(casetta).toHaveAttribute("aria-checked", "false");
    await expect(you).toBeDisabled();
    await expect(you).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(ON_CONSEQUENCE)).toBeVisible();
    await expect(page.getByText("paused 12 Sep · history kept")).toBeVisible();

    const paint = COLOR[theme];
    await expect(page.locator('[data-state="on"] [data-slot="track"]')).toHaveCSS("background-color", paint.on);
    await expect(page.locator('[data-state="you"] [data-slot="track"]')).toHaveCSS("background-color", paint.you);
    await expect(page.locator('[data-state="off"] [data-slot="track"]')).toHaveCSS("background-color", paint.off);
    await expect(page.locator('[data-state="off"] [data-slot="chip"]')).toHaveCSS("border-top-style", "dashed");
    await expect(page.locator('[data-state="off"] [data-slot="monogram"]')).toHaveCSS("border-top-color", paint.line);
    await expect(page.locator('[data-state="off"]')).toHaveCSS("color", paint.faint);

    expect(await thumbIsRight(page, "on")).toBe(true);
    expect(await thumbIsRight(page, "you")).toBe(true);
    expect(await thumbIsRight(page, "off")).toBe(false);

    for (const control of [kindred, casetta, you]) {
      const box = await control.boundingBox();
      if (box === null) throw new Error("the switch hit target has no box");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);

    await page.screenshot({
      path: testInfo.outputPath(`${width}-${theme}.png`),
      fullPage: true,
    });
  }

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design/brand-switch");
  const kindred = page.getByRole("switch", { name: "Kindred" });
  const casetta = page.getByRole("switch", { name: "Casetta" });
  const you = page.getByRole("switch", { name: "Loopwell" });

  // DESIGN.md 6 and #4017 item 5: turning a brand off never asks for
  // confirmation. A browser dialog during the toggle would fail here.
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.keyboard.press("Tab");
  await expect(kindred).toBeFocused();
  await page.keyboard.press("Space");
  await expect(kindred).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("paused 22 Sep · history kept")).toBeVisible();
  expect(dialogs).toEqual([]);

  await page.locator('[data-state="off"]').filter({ hasText: "Casetta" }).locator('[data-slot="state-label"]').click();
  await expect(casetta).toHaveAttribute("aria-checked", "true");

  await casetta.focus();
  await page.keyboard.press("Tab");
  await expect(you).not.toBeFocused();
  const landed = await page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || active === document.documentElement) return "body";
    return active.getAttribute("aria-label") ?? active.tagName.toLowerCase();
  });
  // Casetta is the last operable switch in the page; the You switch is disabled
  // and is skipped by Tab. Focus therefore leaves the row of switches and lands
  // on document.body until the user shifts context back.
  expect(landed).toBe("body");
});
