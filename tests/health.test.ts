import { beforeEach, describe, expect, it, vi } from "vitest";

// The node project stubs `cloudflare:workers` with an empty env. The version
// metadata binding is injected by the platform at deploy time (#7187), so the
// test hands the loader the value a deploy would.
const workerEnv = vi.hoisted(() => ({
  env: { VERSION_METADATA: { id: "test-version-id", tag: "0123456789abcdef0123456789abcdef01234567" } },
}));

vi.mock("cloudflare:workers", () => ({ env: workerEnv.env }));

import { loader } from "../app/routes/api.health";

describe("/api/health", () => {
  beforeEach(() => {
    workerEnv.env.VERSION_METADATA.tag = "0123456789abcdef0123456789abcdef01234567";
  });

  it("answers ok without reading anything", async () => {
    const body = await (loader() as Response).json();
    expect(body).toMatchObject({ status: "ok", app: "0509" });
    expect(Date.parse((body as { timestamp: string }).timestamp)).not.toBeNaN();
  });

  it("names the commit the deploy tagged", async () => {
    const body = (await (loader() as Response).json()) as { commit: string };
    expect(body.commit).toBe("0123456789abcdef0123456789abcdef01234567");
  });
});
