import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({
  workspaceId: null as string | null,
  shots: new Set<string>(),
  sessionReads: 0,
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("../../app/lib/env.server", () => ({
  landingWorkspaceId: () => gate.workspaceId,
}));

vi.mock("../../app/lib/site-changes.server", () => ({
  readChangeShot: async (workspaceId: string, signalId: string, side: string) => {
    if (!gate.shots.has(`${workspaceId}:${signalId}:${side}`)) return null;
    return {
      body: "png-bytes",
      httpMetadata: { contentType: "image/png" },
      httpEtag: "etag-1",
    };
  },
}));

vi.mock("../../app/lib/require-session.server", () => ({
  requireSession: async () => {
    gate.sessionReads += 1;
    throw new Response(null, { status: 302, headers: { Location: "/login" } });
  },
}));

vi.mock("../../app/lib/data/workspace.server", () => ({
  readWorkspaceIdForOwner: async () => "ws-owner",
}));

import { loader } from "../../app/routes/app.change-shot";

function load(signalId: string, side: string) {
  const request = new Request(`https://0509.io/app/changes/${signalId}/${side}`);
  return loader({ request, params: { signalId, side }, context: {} } as Parameters<typeof loader>[0]);
}

describe("change shot", () => {
  beforeEach(() => {
    gate.workspaceId = null;
    gate.shots.clear();
    gate.sessionReads = 0;
  });

  it("serves a public-workspace capture with no session", async () => {
    gate.workspaceId = "ws-public";
    gate.shots.add("ws-public:sig-own:after");
    const response = await load("sig-own", "after");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(gate.sessionReads).toBe(0);
  });

  it("redirects a signed-out request that is not in the public workspace", async () => {
    gate.workspaceId = "ws-public";
    gate.shots.add("ws-owner:sig-private:after");
    await expect(load("sig-private", "after")).rejects.toMatchObject({ status: 302 });
    expect(gate.sessionReads).toBe(1);
  });

  it("keeps the signed-out redirect when the public workspace is unset", async () => {
    gate.shots.add("ws-public:sig-own:after");
    await expect(load("sig-own", "after")).rejects.toMatchObject({ status: 302 });
    expect(gate.sessionReads).toBe(1);
  });

  it("answers a bad side with the missing-screenshot page", async () => {
    gate.workspaceId = "ws-public";
    const response = await load("sig-own", "sideways");
    expect(response.status).toBe(404);
    expect(gate.sessionReads).toBe(0);
  });
});
