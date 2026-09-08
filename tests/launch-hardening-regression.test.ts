import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveWorkspace, resolveWorkspaceDataUserId } from "~/lib/workspace.server";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn(async (_env: unknown, userId: string) =>
    userId.startsWith("agency") ? "agency" : "starter",
  ),
}));

function fakeDb(firstResults: Array<Record<string, unknown>> = []) {
  const queue = [...firstResults];
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return queue.shift() ?? null;
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

describe("workspace API plan resolution", () => {
  it("resolves agency workspace members to the owner data user id", async () => {
    const db = fakeDb([{ ownerUserId: "agency-owner", ownerName: "Asha" }]);
    await expect(resolveWorkspaceDataUserId({ DB: db } as never, "member-1")).resolves.toBe(
      "agency-owner",
    );
  });

  it("keeps personal keys on the member user id when they are not in an agency workspace", async () => {
    const db = fakeDb([]);
    await expect(resolveWorkspaceDataUserId({ DB: db } as never, "solo-1")).resolves.toBe("solo-1");
  });

  it("drops removed or downgraded members back to their personal workspace", async () => {
    const db = fakeDb([{ ownerUserId: "downgraded-owner", ownerName: "Asha" }]);
    const ctx = await resolveWorkspace({ DB: db } as never, "member-1");
    expect(ctx).toEqual({
      workspaceUserId: "member-1",
      isMember: false,
      ownerName: null,
    });
  });
});
