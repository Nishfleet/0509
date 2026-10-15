import { describe, expect, it } from "vitest";

import { takeRecipientSlot } from "../../app/lib/recipient-cap.server";

const NOW = new Date(Date.now() + 60_000);
const HOUR = 3_600_000;

describe("takeRecipientSlot", () => {
  it("lets an address receive three emails in a day and refuses the fourth", async () => {
    const address = "capped-one@example.test";
    const results = [];
    for (let i = 0; i <= 3; i += 1) {
      results.push(await takeRecipientSlot(address, new Date(NOW.getTime() + i * HOUR)));
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it("counts each address on its own", async () => {
    for (let i = 0; i < 3; i += 1) await takeRecipientSlot("capped-two@example.test", NOW);
    expect(await takeRecipientSlot("capped-two@example.test", NOW)).toBe(false);
    expect(await takeRecipientSlot("capped-three@example.test", NOW)).toBe(true);
  });

  it("opens again once the day has passed since the first email", async () => {
    for (let i = 0; i < 3; i += 1) await takeRecipientSlot("capped-four@example.test", NOW);
    expect(await takeRecipientSlot("capped-four@example.test", new Date(NOW.getTime() + 23 * HOUR))).toBe(false);
    expect(await takeRecipientSlot("capped-four@example.test", new Date(NOW.getTime() + 25 * HOUR))).toBe(true);
  });
});
