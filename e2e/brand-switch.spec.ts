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
  expect(edges.thumbLeft, JSON.stringify(edges)).toBeGreaterThanOrEqual(edges.trackLeft);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("a row's switch is square and paints the card fill when off @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  const cookie = await seedRankedHomeSession("switch-geometry");
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app");
  const track = page.getByRole("switch", { name: "Kindred tracking" });
  await expect(track).toBeVisible();
  await track.click();
  await expect(track).not.toBeChecked();

  const paint = await track.evaluate((element) => {
    const style = getComputedStyle(element);
    const thumb = element.querySelector<HTMLElement>('[data-slot="switch-thumb"]');
    return {
      radius: style.borderRadius,
      background: style.backgroundColor,
      width: element.getBoundingClientRect().width,
      thumbLeft: thumb?.getBoundingClientRect().left ?? 0,
      trackLeft: element.getBoundingClientRect().left,
    };
  });
  // DESIGN §3: radius is 0 everywhere, on the track as on the thumb.
  expect(paint.radius, JSON.stringify(paint)).toBe("0px");
  // --card, not --line: --color-input aliases --line, and the stock off track
  // filled with bg-input, which is why brand-switch pins the off fill to card.
  expect(paint.background, JSON.stringify(paint)).toBe("rgb(255, 253, 246)");
  expect(paint.width).toBe(38);
  // Off thumb sits flush at the 1.5px hairline, inside the track.
  expect(paint.thumbLeft - paint.trackLeft).toBeGreaterThanOrEqual(1.4);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
