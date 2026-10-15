import { expect, test } from "./test";

import { consoleFailures, isLocalLane, watchConsole } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

test.skip(
  !isLocalLane(),
  "seeds a ranked workspace in the local preview database; production reads a real ranked /app",
);

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

  expect(edges.thumbRight - edges.trackLeft, JSON.stringify(edges)).toBeGreaterThanOrEqual(34);
  expect(edges.thumbLeft, JSON.stringify(edges)).toBeGreaterThanOrEqual(edges.trackLeft);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

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

  await expect(async () => {
    const paint = await track.evaluate((element) => {
      const style = getComputedStyle(element);
      const thumb = element.querySelector<HTMLElement>('[data-slot="switch-thumb"]');
      if (thumb === null) throw new Error("the switch renders no thumb");
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--card)";
      document.body.appendChild(probe);
      const card = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        radius: style.borderRadius,
        background: style.backgroundColor,
        card,
        width: element.getBoundingClientRect().width,
        thumbLeft: thumb.getBoundingClientRect().left,
        thumbRight: thumb.getBoundingClientRect().right,
        trackLeft: element.getBoundingClientRect().left,
        trackRight: element.getBoundingClientRect().right,
      };
    });

    expect(paint.radius, JSON.stringify(paint)).toBe("0px");
    expect(paint.background, JSON.stringify(paint)).toBe(paint.card);
    expect(paint.width).toBe(38);

    expect(paint.thumbLeft - paint.trackLeft, JSON.stringify(paint)).toBeGreaterThanOrEqual(1);
    expect(paint.thumbLeft - paint.trackLeft, JSON.stringify(paint)).toBeLessThanOrEqual(2);
    expect(paint.thumbRight, JSON.stringify(paint)).toBeLessThanOrEqual(paint.trackRight);
  }).toPass({ timeout: 3000 });

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("the Competitors list says what a switch does once, not under every brand @smoke", async ({ page }, testInfo) => {
  test.skip(!isLocalLane(), "pauses a brand, so it runs only on the workspace seeded for this run");
  const watched = watchConsole(page);

  const cookie = await seedRankedHomeSession("switch-note-once");
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app/competitors");
  const toggle = page.getByRole("switch", { name: "Kindred tracking" });
  await expect(toggle).toBeVisible();

  const noteId = await toggle.getAttribute("aria-describedby");
  const note = page.locator(`[id="${noteId ?? ""}"]`);
  await expect(note).toContainText("Turn off to stop watching and alerts");
  const box = await note.boundingBox();
  expect(box === null || box.width <= 1, "the consequence stays for screen readers only").toBe(true);

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(note).toContainText(/Paused .*history kept/);
  const pausedBox = await note.boundingBox();
  expect(pausedBox?.width ?? 0, "a paused row still prints its date").toBeGreaterThan(1);

  await toggle.click();
  await expect(toggle).toBeChecked();

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
