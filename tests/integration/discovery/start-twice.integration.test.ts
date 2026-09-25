import { describe, expect, it } from "vitest";

import { startDiscovery } from "../../../app/lib/discovery/start.server";

describe("startDiscovery", () => {
  it("starting the same workspace twice keeps the first instance id", async () => {
    const now = new Date("2026-09-25T08:00:00Z");
    const first = await startDiscovery("ws-start-twice", now);
    await expect(startDiscovery("ws-start-twice", now)).resolves.toBe(first);
  });
});
