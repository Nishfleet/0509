import { describe, expect, it, vi } from "vitest";

// The node project stubs `cloudflare:workers` with an empty env. The version
// metadata binding is injected by the platform at deploy time (#7187), so the
// test hands the loader the value a deploy would.
const workerEnv = vi.hoisted(() => ({
  env: { VERSION_METADATA: { id: "test-version-id", tag: "" } },
}));

vi.mock("cloudflare:workers", () => ({ env: workerEnv.env }));

import { loader } from "../app/routes/api.health";

describe("/api/health", () => {
  it("answers ok without reading anything", async () => {
    const body = await (loader() as Response).json();
    expect(body).toMatchObject({ status: "ok", app: "0509" });
    expect(Date.parse((body as { timestamp: string }).timestamp)).not.toBeNaN();
  });

  it("names the tag the Worker version carries, a fresh read per request", async () => {
    workerEnv.env.VERSION_METADATA.tag = "0123456789abcdef0123456789abcdef01234567";
    const first = (await (loader() as Response).json()) as { commit: string };

    workerEnv.env.VERSION_METADATA.tag = "fedcba9876543210fedcba9876543210fedcba98";
    const second = (await (loader() as Response).json()) as { commit: string };

    expect(first.commit).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(second.commit).toBe("fedcba9876543210fedcba9876543210fedcba98");
  });
});
