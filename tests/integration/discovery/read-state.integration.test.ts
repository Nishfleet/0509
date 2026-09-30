import { env, introspectWorkflow } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readDiscoveryState, startDiscovery } from "../../../app/lib/discovery/start.server";

describe("readDiscoveryState", () => {
  it("reads a workspace whose instance is not created yet as still looking", async () => {
    await expect(readDiscoveryState("ws-not-started", new Date("2026-09-25T08:00:00Z"))).resolves.toBe("looking");
  });

  it("reads a started instance as looking until it completes", async () => {
    await using introspector = await introspectWorkflow(env.DISCOVERY);
    const now = new Date("2026-09-25T08:00:00Z");
    await startDiscovery("ws-read-state", now);
    await expect(readDiscoveryState("ws-read-state", now)).resolves.toBe("looking");
    expect(await introspector.get()).toHaveLength(1);
  });
});
