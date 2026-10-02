import type { Page } from "@playwright/test";

export async function readSettings(page: Page) {
  await page.goto("/app/settings");
  const day = Number(await page.getByLabel("Day").inputValue());
  const hour = Number(await page.getByLabel("Time").inputValue());
  const text = (await page.getByText(/Time zone:.*Next\s+brief:/).first().innerText()).replace(/\s+/g, " ");
  const timezone = /Time zone: (.+?)\. Next brief: (.+)\.$/.exec(text);
  return {
    day,
    hour,
    timezone: (timezone?.[1] ?? "").replaceAll(" ", "_"),
    nextLine: timezone?.[2] ?? text,
    at: new Date().toISOString(),
  };
}

