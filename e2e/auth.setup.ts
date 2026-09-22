import { expect, test as setup } from "@playwright/test";
import { accessStatePath } from "../playwright.config";

setup("exchange the Access service token for the CF_Authorization cookie", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/login`, {
    headers: {
      "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
      "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
    },
  });
  expect(response.status()).toBe(200);
  await request.storageState({ path: accessStatePath });
});
