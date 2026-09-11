import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth.server", () => ({
  requireWorkspaceSession: vi.fn(async () => ({ workspaceUserId: "user-1" })),
}));
vi.mock("~/lib/context.server", () => ({
  getEnv: vi.fn((context) => context.cloudflare.env),
}));

const createPresenceEntity = vi.fn();

vi.mock("~/lib/presence-service.server", () => {
  class PresenceServiceError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    addPresenceSourceTarget: vi.fn(),
    createPresenceEntity,
    deletePresenceEntity: vi.fn(),
    pollPresenceSourceTarget: vi.fn(),
    PresenceServiceError,
  };
});

function createEntityRequest(trackingMode: string) {
  const formData = new FormData();
  formData.set("intent", "create-entity");
  formData.set("trackingMode", trackingMode);
  formData.set("label", "Acme Corp");
  return new Request("https://example.test/app/presence", {
    method: "POST",
    body: formData,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("app.presence action validation", () => {
  it("rejects an unknown trackingMode with a 400 form error instead of a D1 constraint 500", async () => {
    const { action } = await import("~/routes/app.presence");
    const response = await action({
      context: { cloudflare: { env: {} } },
      request: createEntityRequest("bogus"),
    } as never);

    const result = (response as { data?: { formError?: string }; init?: ResponseInit }) ?? {};
    expect(result.init?.status).toBe(400);
    expect(result.data?.formError).toBe("Choose a valid tracking mode.");
    expect(createPresenceEntity).not.toHaveBeenCalled();
  });

  it("accepts the valid tracking modes and creates the entity", async () => {
    createPresenceEntity.mockResolvedValue({ id: "entity-1" });
    const { action } = await import("~/routes/app.presence");
    for (const trackingMode of ["competitor", "self"]) {
      const response = await action({
        context: { cloudflare: { env: {} } },
        request: createEntityRequest(trackingMode),
      } as never);
      expect(createPresenceEntity).toHaveBeenCalledWith(expect.anything(), "user-1", {
        trackingMode,
        label: "Acme Corp",
        canonicalUrl: null,
      });
      void response;
    }
  });
});
