import { env } from "cloudflare:test";
import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/lib/require-session.server", () => ({
  requireSession: async () => ({ user: { id: "user-return", email: "return@example.com" } }),
}));

import { onboardedContext } from "../../app/lib/require-onboarded.server";
import { loader } from "../../app/routes/app.competitors";

function competitorsLoader(search: string): ReturnType<typeof loader> {
  const request = new Request(`https://0509.io/app/competitors${search}`);
  const context = new RouterContextProvider();
  context.set(onboardedContext, {
    session: { user: { id: "user-return", email: "return@example.com" } },
    workspaceId: "ws-return",
  } as never);
  return loader({ request, params: {}, context } as unknown as Parameters<typeof loader>[0]);
}

describe("competitors loader after checkout (J13)", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM plan").run();
    await env.DB.prepare("DELETE FROM workspace").run();
    await env.DB.prepare('DELETE FROM "user"').run();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-return', 'Return', 'return@example.com', 1, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES ('ws-return', 'Return', 'user-return', 'UTC', 1, 8, '2026-09-29T00:00:00Z')`,
    ).run();
  });

  it("reports scout and the plan being waited for until the plan row lands, then the paid tier", async () => {
    const waiting = await competitorsLoader("?upgraded=starter");
    expect(waiting).toMatchObject({ tier: "scout", wanted: "starter" });

    await env.DB.prepare(
      `INSERT INTO plan (id, workspace_id, tier, status, updated_at)
       VALUES ('plan-return', 'ws-return', 'starter', 'active', '2026-09-29T10:00:00Z')`,
    ).run();

    const landed = await competitorsLoader("?upgraded=starter");
    expect(landed).toMatchObject({ tier: "starter", wanted: "starter" });
  });

  it("ignores an upgraded value that is not a plan", async () => {
    expect(await competitorsLoader("?upgraded=platinum")).toMatchObject({ wanted: null });
    expect(await competitorsLoader("")).toMatchObject({ tier: "scout", wanted: null });
  });
});
