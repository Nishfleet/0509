import { expect, test, type Locator, type Page } from "@playwright/test";

import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

// Preview-lane proof for #5441 and #5557: Enter saves and closes the identity card
// editor, Escape saves and closes, and Base UI returns focus to the trigger.
// `e2e/onboarding-identity.spec.ts` keeps the production walk on the same
// component, but its signed-in describe skips in this lane (no inbox), so
// this spec seeds the local preview D1 the same way `e2e/alerts-chips.spec.ts`
// does and exercises the keyboard paths on the real built Worker.
//
// The seeded user owns a workspace with no self entity, so the identity route
// renders instead of redirecting to /app, and a `public_subject:confirmed`
// decision for the subject, so `screenOnboardingSubject` returns proceed
// without a Jev call. The probed host does not resolve, so `readSiteCard`
// returns the unfound card — empty fields, every `EditRow` openable — and the
// keyboard paths the packet specifies are reachable without any network.
//
// At 390 the `Row` now wraps the empty-line span under the trigger,
// giving the edit name/about triggers a non-zero bounding box on the unread card.
// 0509#5557 owns this fix; the 390 lane asserts the triggers are clickable.
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
  // 0509#5557: an empty-line span beside the `min-w-0 flex-1` trigger used to
  // starve it to 0px wide on the unread card at 390; this keeps that from
  // returning silently.
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
  await expect(page.getByRole("heading", { name: "This is you. Fix anything we got wrong." })).toBeVisible();

  const trigger = page.getByRole("button", { name: TRIGGERS.name });
  const name = await openEditor(page, "name");
  await name.fill("Brand One");
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/onboarding/identity.data",
  );
  await name.press("Enter");

  // The controlled `open` prop closing does not fire Popover's onOpenChange, so
  // Enter reaches onSave through exactly one path, and `saveOnEnter` calls it
  // inside the keydown handler. Awaiting that save's response proves the one POST
  // round-tripped, so the `toHaveLength(1)` count below is the post-save count, not
  // a zero read taken before the request went out; a second `onSave` from that
  // same keydown task would be dispatched, and observed by `watchDraftPosts`,
  // before this response returns.
  await saveResponse;
  expect(draftPosts).toHaveLength(1);
  await expect(name).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("Brand One");
  await expect(page.locator('input[type="hidden"][name="name"]')).toHaveValue("Brand One");
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
  await expect(page.getByRole("heading", { name: "This is you. Fix anything we got wrong." })).toBeVisible();

  const trigger = page.getByRole("button", { name: TRIGGERS.about });
  const about = await openEditor(page, "about");
  await about.fill("one line on what we do");
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/onboarding/identity.data",
  );
  await about.press("Escape");

  await saveResponse;
  expect(draftPosts).toHaveLength(1);
  await expect(about).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("one line on what we do");
  await expect(page.locator('input[type="hidden"][name="description"]')).toHaveValue("one line on what we do");
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
