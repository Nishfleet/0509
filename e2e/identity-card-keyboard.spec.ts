import { type Locator, type Page } from "@playwright/test";
import { expect, test } from "./test";

import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

test.skip(!isLocalLane(), "production signs in through the magic-link inbox; the local preview D1 carries the seed");

async function seedCardSession(registrable: string): Promise<string> {
  const { cookie } = await seedPreviewSession("card-keyboard", ({ db, suffix, userId }) => {
    const workspaceId = `ws-${suffix}`;
    const stamp = "2026-09-25T00:00:00.000Z";
    run(
      db,
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
      workspaceId,
      "Card Keyboard",
      userId,
      stamp,
    );
    run(
      db,
      "INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at) VALUES (?, ?, ?, NULL, NULL, 'public_subject:confirmed', ?, ?)",
      `ud-${suffix}`,
      workspaceId,
      userId,
      registrable,
      stamp,
    );
  });
  return cookie;
}

const TRIGGERS: Record<"name" | "about", RegExp> = {
  name: /^edit name\b/,
  about: /^edit about\b/,
};

async function openEditor(page: Page, field: "name" | "about"): Promise<Locator> {
  const trigger = page.getByRole("button", { name: TRIGGERS[field] });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  const box = await trigger.boundingBox();
  if (box === null) throw new Error(`the edit ${field} trigger has no bounding box`);

  expect(box.width, `edit ${field} trigger has zero width`).toBeGreaterThan(0);
  await trigger.click();
  const editor = page.getByRole("textbox", { name: field });
  await expect(editor).toBeVisible({ timeout: 5_000 });
  return editor;
}

function watchDraftPosts(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/onboarding/identity.data") {
      posts.push(request.url());
    }
  });
  return posts;
}

test("the identity card editor saves and closes on Enter, with focus back on the trigger", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const watched = watchConsole(page);
  const draftPosts = watchDraftPosts(page);
  const subject = "nope-card-keyboard-enter.example.com";
  await page.setExtraHTTPHeaders({ cookie: await seedCardSession("example.com") });

  const response = await page.goto(`/onboarding/identity?subject=${subject}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Check your details. Fix anything that's wrong." })).toBeVisible();

  const trigger = page.getByRole("button", { name: TRIGGERS.name });
  const name = await openEditor(page, "name");
  await name.fill("Brand One");
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/onboarding/identity.data",
  );
  await name.press("Enter");

  expect((await saveResponse).status()).toBe(200);
  expect(draftPosts).toHaveLength(1);
  await expect(name).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("Brand One");
  await expect(page.locator('input[type="hidden"][name="name"]')).toHaveValue("Brand One");
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("the identity card editor ignores the Enter that confirms an IME composition", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const watched = watchConsole(page);
  const draftPosts = watchDraftPosts(page);
  const subject = "nope-card-keyboard-ime.example.com";
  await page.setExtraHTTPHeaders({ cookie: await seedCardSession("example.com") });

  const response = await page.goto(`/onboarding/identity?subject=${subject}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Check your details. Fix anything that's wrong." })).toBeVisible();

  const trigger = page.getByRole("button", { name: TRIGGERS.name });
  const name = await openEditor(page, "name");
  await name.fill("ニホン");

  const composingEnter = await name.evaluate((element) => {
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(composingEnter).toBe(false);
  await expect(name).toHaveCount(1);
  await expect(name).toHaveValue("ニホン");
  expect(draftPosts).toHaveLength(0);

  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/onboarding/identity.data",
  );
  await name.press("Enter");
  await saveResponse;
  expect(draftPosts).toHaveLength(1);
  await expect(name).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("ニホン");
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("the identity card editor saves and closes on Escape, with focus back on the trigger", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const watched = watchConsole(page);
  const draftPosts = watchDraftPosts(page);
  const subject = "nope-card-keyboard-escape.example.com";
  await page.setExtraHTTPHeaders({ cookie: await seedCardSession("example.com") });

  const response = await page.goto(`/onboarding/identity?subject=${subject}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Check your details. Fix anything that's wrong." })).toBeVisible();

  const trigger = page.getByRole("button", { name: TRIGGERS.about });
  const about = await openEditor(page, "about");
  await about.fill("one line on what we do");
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/onboarding/identity.data",
  );
  await about.press("Escape");

  expect((await saveResponse).status()).toBe(200);
  expect(draftPosts).toHaveLength(1);
  await expect(about).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("one line on what we do");
  await expect(page.locator('input[type="hidden"][name="description"]')).toHaveValue("one line on what we do");
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
