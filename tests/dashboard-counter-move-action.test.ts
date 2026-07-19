import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  user: { id: "owner-1", email: "owner@example.com", name: "Owner" },
  session: { id: "session-1", userId: "owner-1", expiresAt: "2026-12-31T00:00:00.000Z" },
};

function mockWorkspaceSession(options: {
  workspaceUserId?: string;
  isMember?: boolean;
}) {
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn(async () => ({
      session,
      workspaceUserId: options.workspaceUserId ?? "owner-1",
      isMember: options.isMember ?? false,
      ownerName: options.isMember ? "Owner" : null,
    })),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue("starter"),
    checkPlanLimit: vi.fn(),
  }));
}

function mockCloseCounterMove(result: { ok: boolean }) {
  const closeCounterMoveFollowUp = vi.fn().mockResolvedValue(result);
  vi.doMock("~/lib/data.server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/data.server")>();
    return {
      ...actual,
      closeCounterMoveFollowUp,
    };
  });
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn((context: { cloudflare: { env: unknown } }) => context.cloudflare.env),
  }));
  return closeCounterMoveFollowUp;
}

async function postCloseCounterMove(form: Record<string, string>) {
  const { action } = await import("~/routes/app.dashboard");
  const formData = new FormData();
  for (const [key, value] of Object.entries(form)) {
    formData.set(key, value);
  }
  return action({
    context: { cloudflare: { env: {} } },
    request: new Request("http://localhost/app", {
      method: "POST",
      body: formData,
    }),
  } as never);
}

describe("dashboard close-counter-move action", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("marks an open follow-up done for the workspace owner", async () => {
    mockWorkspaceSession({});
    const closeCounterMoveFollowUp = mockCloseCounterMove({ ok: true });

    const result = await postCloseCounterMove({
      intent: "close-counter-move",
      auditId: "audit-1",
      eventId: "event-1",
    });

		expect(result).toEqual({ ok: true, intent: "close-counter-move", message: "Marked done." });
    expect(closeCounterMoveFollowUp).toHaveBeenCalledWith(
      {},
      {
        auditId: "audit-1",
        eventId: "event-1",
        userId: "owner-1",
      },
    );
  });

  it("uses the agency owner user id for workspace members", async () => {
    mockWorkspaceSession({ workspaceUserId: "agency-owner", isMember: true });
    const closeCounterMoveFollowUp = mockCloseCounterMove({ ok: true });

    await postCloseCounterMove({
      intent: "close-counter-move",
      auditId: "audit-1",
      eventId: "event-1",
    });

    expect(closeCounterMoveFollowUp).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "agency-owner" }),
    );
  });

  it("rejects missing audit or event identifiers", async () => {
    mockWorkspaceSession({});
    mockCloseCounterMove({ ok: true });

    const result = await postCloseCounterMove({
      intent: "close-counter-move",
      auditId: "",
      eventId: "event-1",
    });

		expect(result).toEqual({
			ok: false,
			intent: "close-counter-move",
			message: "We couldn't mark that follow-up done. Refresh and try again.",
		});
  });

  it("reports closed or cross-workspace follow-ups as no longer open", async () => {
    mockWorkspaceSession({});
    mockCloseCounterMove({ ok: false });

    const result = await postCloseCounterMove({
      intent: "close-counter-move",
      auditId: "audit-other-workspace",
      eventId: "event-1",
    });

		expect(result).toEqual({ ok: false, intent: "close-counter-move", message: "That follow-up is no longer open." });
  });

  it("returns the same closed message when marking an already completed item again", async () => {
    mockWorkspaceSession({});
    mockCloseCounterMove({ ok: false });

    const first = await postCloseCounterMove({
      intent: "close-counter-move",
      auditId: "audit-1",
      eventId: "event-1",
    });
    const second = await postCloseCounterMove({
      intent: "close-counter-move",
      auditId: "audit-1",
      eventId: "event-1",
    });

		expect(first).toEqual({ ok: false, intent: "close-counter-move", message: "That follow-up is no longer open." });
		expect(second).toEqual({ ok: false, intent: "close-counter-move", message: "That follow-up is no longer open." });
  });
});
