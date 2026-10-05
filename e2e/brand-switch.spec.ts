import { expect, test } from "@playwright/test";

import { consoleFailures, isLocalLane, watchConsole } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

test.skip(
  !isLocalLane(),
  "seeds a ranked workspace in the local preview database; production reads a real ranked /app",
);

// DESIGN.md §6 pins the switch at 38×22, square, ink hairline, ink thumb, 180ms
// travel. Two stock classes fight that: ui/switch's own 32×18.4 track and its
// `calc(100% - 2px)` thumb travel. tailwind-merge removes both once
// brand-switch carries the same `data-[size=default]:` variants, so this
// measures the RENDERED box instead of asserting a class list — a future stock
// edit that wins the cascade fails here rather than shipping a 32px switch.
test("a row's switch box is 38x22 and the checked thumb stays inside it @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  const cookie = await seedRankedHomeSession("switch-geometry");
  await page.setExtraHTTPHeaders({ cookie });

  const response = await page.goto("/app");
  expect(response?.status()).toBe(200);

  const track = page.getByRole("switch", { name: "Kindred tracking" });
  await expect(track).toBeVisible();
  await expect(track).toBeChecked();

  const box = await track.boundingBox();
  expect(box?.width, JSON.stringify(box)).toBe(38);
  expect(box?.height, JSON.stringify(box)).toBe(22);

  // The checked thumb sits inside the track: its right edge may not pass the
  // track's right inner edge (38 - 1.5 hairline = 36.5). On main the 32px track
  // put the thumb's right edge at 33.5 against a track that ended at 32.
  const edges = await track.evaluate((element) => {
    const trackBox = element.getBoundingClientRect();
    const thumb = element.querySelector<HTMLElement>('[data-slot="switch-thumb"]');
    if (thumb === null) throw new Error("the switch renders no thumb");
    const thumbBox = thumb.getBoundingClientRect();
    return {
      trackLeft: trackBox.left,
      trackRight: trackBox.right,
      thumbLeft: thumbBox.left,
      thumbRight: thumbBox.right,
    };
  });
  expect(edges.thumbRight, JSON.stringify(edges)).toBeLessThanOrEqual(edges.trackRight);
  expect(edges.thumbRight - edges.trackLeft, JSON.stringify(edges)).toBeLessThanOrEqual(38 - 1.5);
  // And it travels the full 17.5px: a stock `calc(100% - 2px)` travel that won
  // the cascade would stop the thumb 3.5px short, inside the bounds above.
  expect(edges.thumbRight - edges.trackLeft, JSON.stringify(edges)).toBeGreaterThanOrEqual(34);
  expect(edges.thumbLeft, JSON.stringify(edges)).toBeGreaterThanOrEqual(edges.trackLeft);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

// The off state needs a switch that answers a click without a server round
// trip: `/app/competitors` is where the fetcher's own pending intent drives
// `BrandSwitch`'s state (`CompetitorItem` reads `fetcher.formData`), so the off
// paint is measured on the same component the Home row draws, without waiting
// on the post to `/app/competitors` that Home's switch makes.
test("a row's switch is square and paints the card fill when off @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  const cookie = await seedRankedHomeSession("switch-geometry");
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app/competitors");
  const track = page.getByRole("switch", { name: "Kindred tracking" });
  await expect(track).toBeVisible();
  await expect(track).toBeChecked();
  await track.click();
  await expect(track).not.toBeChecked();

  // The stock root carries `transition-all` and the thumb `duration-180`, so
  // the off paint is read through a polling assert: a single read lands
  // mid-flight (measured: 84% of the 180ms travel, thumb at 5.8px and the fill
  // still blending `--green` toward `--card`).
  await expect(async () => {
    const paint = await track.evaluate((element) => {
      const style = getComputedStyle(element);
      const thumb = element.querySelector<HTMLElement>('[data-slot="switch-thumb"]');
      if (thumb === null) throw new Error("the switch renders no thumb");
      return {
        radius: style.borderRadius,
        background: style.backgroundColor,
        width: element.getBoundingClientRect().width,
        thumbLeft: thumb.getBoundingClientRect().left,
        thumbRight: thumb.getBoundingClientRect().right,
        trackLeft: element.getBoundingClientRect().left,
        trackRight: element.getBoundingClientRect().right,
      };
    });
    // DESIGN §3: radius is 0 everywhere, on the track as on the thumb.
    expect(paint.radius, JSON.stringify(paint)).toBe("0px");
    // --card, not --line: --color-input aliases --line, and the stock off track
    // filled with bg-input, which is why brand-switch pins the off fill to card.
    expect(paint.background, JSON.stringify(paint)).toBe("rgb(255, 253, 246)");
    expect(paint.width).toBe(38);
    // Off thumb sits flush at the track's hairline and stays inside it: the
    // stock `data-unchecked:translate-x-0` out-sorts brand-switch's own
    // `translate-x-[1.5px]` (its selector is longer), so the thumb rests on the
    // border edge — 1px, because Chrome rounds the 1.5px border down at DPR 1.
    expect(paint.thumbLeft - paint.trackLeft, JSON.stringify(paint)).toBeGreaterThanOrEqual(1);
    expect(paint.thumbLeft - paint.trackLeft, JSON.stringify(paint)).toBeLessThanOrEqual(2);
    expect(paint.thumbRight, JSON.stringify(paint)).toBeLessThanOrEqual(paint.trackRight);
  }).toPass({ timeout: 3000 });

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
