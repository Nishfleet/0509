import { expect, test, type Page } from "@playwright/test";

import { previousBriefAt } from "../app/lib/brief-schedule";
import { decodedBodies, readRawMessage, requireInboxToken, signInWithMagicLink } from "./inbox";

// J11 from docs/REBUILD-DONE.md §A. Production only: the preview Worker has
// no EMAIL binding and no inbox. One project — the phone project would send a
// second brief, and the check the contract asks for is the HTML at 600 px.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J11 proves the production mail path; the local preview Worker can neither send nor receive email",
);

const ON = ["linear.app", "notion.so", "figma.com"] as const;
const OFF = "slack.com";
const HOUR_MS = 60 * 60 * 1000;
const BRIEF_WAIT_MS = 120_000;
const SUPPRESS_WAIT_MS = 90_000;

function htmlBodyFrom(raw: string): string {
  for (const body of decodedBodies(raw)) {
    const hay = body.toLowerCase();
    const start = hay.indexOf("<!doctype html>");
    if (start === -1) continue;
    const end = hay.indexOf("</html>", start);
    if (end === -1) continue;
    return body.slice(start, end + "</html>".length);
  }
  return "";
}

const MESSAGE_ID = /^message-id:\s*(.+)$/im;
const SENT_DATE = /^date:\s*(.+)$/im;
const LIST_UNSUB = /^list-unsubscribe:\s*(.+)$/im;
const LIST_UNSUB_POST = /^list-unsubscribe-post:\s*(.+)$/im;

function header(raw: string, pattern: RegExp): string | null {
  return pattern.exec(raw)?.[1]?.trim() ?? null;
}

const DEFAULT_WEEKDAY = 1;
const DEFAULT_HOUR = 8;

function localSlot(now: Date, timezone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.find((part) => part.type === "weekday")?.value ?? "",
  );
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return { weekday, hour: hour === 24 ? 0 : hour };
}

function currentSlot(now: Date, timezone: string): { weekday: number; hour: number; timezone: string } {
  return { ...localSlot(now, timezone), timezone };
}

function openingSlot(now: Date): { weekday: number; hour: number; timezone: string } {
  const utc = currentSlot(now, "UTC");
  if (utc.weekday === DEFAULT_WEEKDAY && utc.hour === DEFAULT_HOUR) {
    return currentSlot(now, "Asia/Kolkata");
  }
  return utc;
}

async function saveSchedule(
  page: Page,
  schedule: { weekday: number; hour: number; timezone: string },
): Promise<void> {
  const response = await page.request.post("/app/settings", {
    form: { weekday: String(schedule.weekday), hour: String(schedule.hour), timezone: schedule.timezone },
  });
  expect(response.status(), await response.text()).toBeLessThan(400);
  await page.goto("/app/settings");
  await expect(page.locator("label", { hasText: "Day" }).locator("select")).toHaveValue(String(schedule.weekday));
  await expect(page.locator("label", { hasText: "Time" }).locator("select")).toHaveValue(String(schedule.hour));
}

async function addCompetitor(page: Page, domain: string): Promise<void> {
  await page.locator("#add-competitor").fill(domain);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("switch", { name: `${domain} tracking` })).toBeChecked();
}

async function waitForBrief(to: string, token: string): Promise<string> {
  let raw = "";
  let last = "the inbox held no brief";
  try {
    await expect
      .poll(
        async () => {
          try {
            raw = await readRawMessage(to, token);
          } catch (error) {
            last = error instanceof Error ? error.message : String(error);
            raw = "";
            return false;
          }
          const bodies = decodedBodies(raw).join("\n");
          if (raw.includes("brief@0509.io") && bodies.includes("What was checked")) return true;
          last = "the stored message is not the weekly brief yet";
          return false;
        },
        { timeout: BRIEF_WAIT_MS, intervals: [3_000] },
      )
      .toBe(true);
  } catch {
    throw new Error(
      `No weekly brief for ${to} within ${BRIEF_WAIT_MS / 1000}s (${last}). ` +
        "The inbox keeps one message per recipient, so a magic-link mail still sitting there means the brief has not landed.",
    );
  }
  return raw;
}

function assertOrder(text: string, markers: readonly string[]): void {
  const indexes = markers.map((marker) => ({ marker, index: text.indexOf(marker) }));
  for (const found of indexes) expect(found.index, found.marker).toBeGreaterThanOrEqual(0);
  for (let i = 1; i < indexes.length; i++) {
    expect(indexes[i]?.index, `${indexes[i - 1]?.marker} before ${indexes[i]?.marker}`).toBeGreaterThan(
      indexes[i - 1]?.index ?? -1,
    );
  }
}

test("the weekly brief arrives from the inbox, in order, and unsubscribe stops the next one", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  test.skip(testInfo.project.name === "phone-390", "one production brief; the HTML is checked at 600 px");

  const token = requireInboxToken();
  const tag = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `e2e+${tag}@0509.io`;
  const selfName = `J11 ${tag}`;

  await signInWithMagicLink(page, email, token);
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill("gymshark.com");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/onboarding\/identity\?subject=gymshark\.com$/);
  const editName = page.getByRole("button", { name: "edit name" });
  await expect(editName).toBeVisible({ timeout: 45_000 });
  await editName.click();
  const name = page.getByRole("textbox", { name: "name" });
  await name.fill(selfName);
  await name.press("Escape");
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/);
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/competitors");
  for (const domain of [...ON, OFF]) await addCompetitor(page, domain);
  await page.getByRole("switch", { name: `${OFF} tracking` }).click();
  await expect(page.getByRole("switch", { name: `${OFF} tracking` })).not.toBeChecked();

  const now = new Date();
  const opening = openingSlot(now);
  const scheduledAt = new Date().toISOString();
  await saveSchedule(page, opening);

  const raw = await waitForBrief(email, token);
  const messageId = header(raw, MESSAGE_ID);
  const sentUtc = header(raw, SENT_DATE);
  const unsubHeader = header(raw, LIST_UNSUB);
  const unsubPost = header(raw, LIST_UNSUB_POST);
  expect(messageId, "the brief carries a Message-ID").toBeTruthy();
  expect(sentUtc, "the brief carries a Date").toBeTruthy();
  expect(unsubHeader, "List-Unsubscribe").toMatch(/^<https:\/\/0509\.io\/u\/[^>]+>$/);
  expect(unsubPost).toBe("List-Unsubscribe=One-Click");
  if (!messageId || !sentUtc || !unsubHeader) throw new Error("brief headers were incomplete");

  const html = htmlBodyFrom(raw);
  expect(html, "the brief carries an HTML part").not.toBe("");
  await page.setViewportSize({ width: 600, height: 900 });
  await page.setContent(html);
  const text = await page.locator("body").innerText();
  const variant = text.includes("Quiet week:") ? "quiet" : "blind-source";
  expect(
    text.includes("Quiet week:") || text.includes("not a quiet week we can vouch for"),
    "nothing noteworthy still sends, either as a quiet week or naming a source that has not answered",
  ).toBe(true);
  expect(text, "no D4 picks, so the read-this-first block is the one block a quiet week drops").not.toContain(
    "Read this first",
  );

  const markers = ["You're #", "Your tracked brands", "Your site looks", "What was checked", "Next brief", "Unsubscribe"];
  assertOrder(text, markers);
  const brands = text.slice(text.indexOf("Your tracked brands"), text.indexOf("Your site looks"));
  expect(brands).toContain(selfName);
  for (const domain of ON) expect(brands).toContain(domain);
  expect(brands, "an off brand is absent, not a zeroed line").not.toContain(OFF);
  expect(text).not.toContain(OFF);

  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fits, "rendered HTML at 600 px").toBe(true);
  await testInfo.attach("j11-brief-600", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  const sentIso = new Date(sentUtc).toISOString();
  const blocks = markers.join(">");
  console.log(
    `j11 variant=${variant} message-id=${messageId} sent-utc=${sentIso} scheduled-at=${scheduledAt} blocks=${blocks} read-this-first=absent off=${OFF}`,
  );
  testInfo.annotations.push(
    { type: "message-id", description: messageId },
    { type: "sent-utc", description: sentIso },
    { type: "variant", description: variant },
  );

  const unsubscribeUrl = unsubHeader.slice(1, -1);
  const postAt = new Date().toISOString();
  const unsub = await page.request.post(unsubscribeUrl, {
    form: { "List-Unsubscribe": "One-Click" },
    maxRedirects: 0,
  });
  expect(unsub.status()).toBe(200);

  await page.goto("/app/settings");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("unsubscribed from the brief")).toBeVisible();
  console.log(`j11 email_suppression address=${email} reason=unsubscribed post-at=${postAt}`);

  const followUp = currentSlot(new Date(), opening.timezone === "UTC" ? "Asia/Kolkata" : "UTC");
  const openingClose = previousBriefAt(opening, now);
  const followUpClose = previousBriefAt(followUp, new Date());
  expect(followUpClose.getTime()).not.toBe(openingClose.getTime());
  expect(Date.now() - followUpClose.getTime()).toBeLessThan(HOUR_MS);
  await saveSchedule(page, followUp);

  // A poll that succeeds on the first read cannot prove the next send was
  // skipped. Wait the window the first brief used, then read again.
  await page.waitForTimeout(SUPPRESS_WAIT_MS);
  const later = await readRawMessage(email, token);
  expect(header(later, MESSAGE_ID), "the next brief was not sent").toBe(messageId);
});
