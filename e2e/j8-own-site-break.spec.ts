import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_ACCOUNTS } from "../app/lib/fixture-accounts";
import { decodedBodies, InboxReadError, readRawMessage, requireInboxToken, signInWithMagicLink } from "./inbox";

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J8 needs the production fixture Worker on j8.fixture.0509.in, the hourly own-site check and the mail inbox; the preview lane has none of them",
);

const FIXTURE_HOST = "j8.fixture.0509.in";
const FIXTURE = `https://${FIXTURE_HOST}`;
const POLL_INTERVAL_MS = 30_000;
const TICK_WAIT_MS = 75 * 60_000;
const SWEEP_WAIT_MS = 90 * 60_000;
const OPEN_BUDGET_MS = 70 * 60_000;

const MODES = [
  { mode: "hard", kind: "error 500", waitMs: TICK_WAIT_MS, account: FIXTURE_ACCOUNTS.j8Hard },
  { mode: "soft", kind: "breakage", waitMs: SWEEP_WAIT_MS, account: FIXTURE_ACCOUNTS.j8Soft },
] as const;

type Mode = "off" | (typeof MODES)[number]["mode"];

function fixtureToken(): string {
  const token = process.env.FIXTURE_SITE_TOKEN;
  if (!token) {
    throw new Error("FIXTURE_SITE_TOKEN is not set; J8 cannot break the fixture site");
  }
  return token;
}

async function setMode(mode: Mode): Promise<void> {
  const response = await fetch(`${FIXTURE}/__break?mode=${mode}`, {
    method: "POST",
    headers: { authorization: `Bearer ${fixtureToken()}` },
  });
  expect(response.status, await response.text()).toBe(200);
}

const MESSAGE_ID = /^message-id:\s*(.+)$/im;
const SENT_DATE = /^date:\s*(.+)$/im;
const SUBJECT = /^subject:\s*(.+)$/im;

function header(raw: string, pattern: RegExp): string {
  return pattern.exec(raw)?.[1]?.trim() ?? "";
}

async function waitForMail(
  to: string,
  token: string,
  subject: string,
  after: Date,
  timeoutMs: number,
): Promise<string> {
  let raw = "";
  let last = "the inbox held no message";
  await expect
    .poll(
      async () => {
        try {
          raw = await readRawMessage(to, token);
        } catch (error) {
          if (!(error instanceof InboxReadError) || error.status !== 404) throw error;
          last = "the inbox held no message";
          return false;
        }
        const sent = Date.parse(header(raw, SENT_DATE));
        if (!raw.includes(subject) || !(sent >= after.getTime() - 1_000)) {
          last = `the stored message is "${header(raw, SUBJECT)}" sent ${header(raw, SENT_DATE)}`;
          return false;
        }
        return true;
      },
      {
        timeout: timeoutMs,
        intervals: [POLL_INTERVAL_MS],
        message: `an email "${subject}" to ${to} after ${after.toISOString()}; last seen: ${last}`,
      },
    )
    .toBe(true);
  return raw;
}

async function signInAndWatchFixture(
  page: Page,
  account: { email: string; maxCompetitors: number },
  token: string,
): Promise<void> {
  await signInWithMagicLink(page, account.email, token, /\/(app|onboarding)/);
  if (page.url().includes("/onboarding")) {
    const input = page.getByRole("textbox", { name: "your website, or a handle" });
    await input.fill(FIXTURE_HOST);
    await input.press("Enter");
    const business = page.getByRole("button", { name: "Yes, a business or creator" });
    await expect(async () => {
      if (await business.isVisible()) await business.click();
      await expect(page).toHaveURL(/\/onboarding\/identity\?subject=j8\.fixture\.0509\.in$/, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
    await page.getByRole("button", { name: "edit name" }).click();
    const name = page.getByRole("textbox", { name: "name" });
    await name.fill("Fixture Brand");
    await name.press("Escape");
    await page.getByRole("button", { name: "That's me" }).click();
    await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });
    await page.getByRole("button", { name: "Start watching" }).click();
    await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
  }
  await page.goto("/app/competitors");
  const items = page.getByRole("list", { name: "Competitors" }).getByRole("listitem");
  expect(await items.count(), "the J8 account holds a competitor its journey never adds").toBeLessThanOrEqual(
    account.maxCompetitors,
  );
}

test.describe.configure({ mode: "serial" });

for (const { mode, kind, waitMs, account } of MODES) {
  test(`J8 your own site breaks ${mode}: one incident email, then fixed, then no second email that day @scheduled`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(5 * 60 * 60_000);
    test.skip(testInfo.project.name === "phone-390", "one production run per break; the fixture host is shared");

    const token = requireInboxToken();
    const { email } = account;
    const openSubject = `${FIXTURE_HOST} looks broken: ${kind}`;
    const fixedSubject = `${FIXTURE_HOST} looks fixed: ${kind}`;

    try {
      await setMode("off");
      await signInAndWatchFixture(page, account, token);

      const brokenAt = new Date();
      await setMode(mode);
      const openRaw = await waitForMail(email, token, openSubject, brokenAt, waitMs);
      const openSentAt = new Date(header(openRaw, SENT_DATE));
      const openBody = decodedBodies(openRaw).join("\n");
      expect(openBody).toContain("Seen at");
      expect(openBody).toContain("We re-check at");
      expect(openBody).toContain("https://0509.io/app/alerts");
      if (mode === "hard") {
        expect(openSentAt.getTime() - brokenAt.getTime(), "hard break email within one tick").toBeLessThan(
          OPEN_BUDGET_MS,
        );
      }
      const openId = header(openRaw, MESSAGE_ID);
      expect(openId).not.toBe("");

      const repairedAt = new Date();
      await setMode("off");
      const fixedRaw = await waitForMail(email, token, fixedSubject, repairedAt, TICK_WAIT_MS);
      const fixedId = header(fixedRaw, MESSAGE_ID);
      expect(fixedId).not.toBe(openId);
      expect(decodedBodies(fixedRaw).join("\n")).toContain("it looks fixed");

      await page.goto("/app/alerts");
      const openIncidents = page.getByTestId("incident-block");
      await expect(openIncidents).toHaveCount(0);

      const openDay = openSentAt.toISOString().slice(0, 10);
      await setMode(mode);
      await expect
        .poll(
          async () => {
            await page.goto("/app/alerts");
            return openIncidents.count();
          },
          {
            timeout: waitMs,
            intervals: [POLL_INTERVAL_MS],
            message: "a second incident opens on the alerts page after the second break",
          },
        )
        .toBe(1);
      expect(
        new Date().toISOString().slice(0, 10),
        "the second break opened on the same UTC day as the first email",
      ).toBe(openDay);

      const later = await readRawMessage(email, token);
      expect(header(later, MESSAGE_ID), "the second incident sent no second open email that day").toBe(fixedId);

      console.log(
        `j8 mode=${mode} broken-at=${brokenAt.toISOString()} open-message-id=${openId} open-sent-utc=${openSentAt.toISOString()} ` +
          `repaired-at=${repairedAt.toISOString()} fixed-message-id=${fixedId} fixed-sent-utc=${new Date(header(fixedRaw, SENT_DATE)).toISOString()}`,
      );
      testInfo.annotations.push(
        { type: "open-message-id", description: openId },
        { type: "fixed-message-id", description: fixedId },
      );
    } finally {
      await setMode("off");
    }
  });
}
