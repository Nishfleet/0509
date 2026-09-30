import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  env: { DODO_PAYMENTS_API_KEY: "key", DODO_ENVIRONMENT: "test_mode", BETTER_AUTH_URL: "https://0509.io" },
  requireFreshSession: vi.fn(),
  readWorkspaceIdForOwner: vi.fn(),
  readPlanCustomerId: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("dodopayments", () => {
  class APIError extends Error {
    status = 500;
  }
  class DodoPayments {
    static APIError = APIError;
    customers = { customerPortal: { create: mocks.create } };
  }
  return { default: DodoPayments };
});
vi.mock("../../app/lib/require-session.server", () => ({ requireFreshSession: mocks.requireFreshSession }));
vi.mock("../../app/lib/data/workspace.server", () => ({ readWorkspaceIdForOwner: mocks.readWorkspaceIdForOwner }));
vi.mock("../../app/lib/data/plan.server", () => ({ readPlanCustomerId: mocks.readPlanCustomerId }));

import DodoPayments from "dodopayments";

import { createPortalUrl } from "../../app/lib/billing/portal.server";
import { action } from "../../app/routes/settings.billing";

const UNAVAILABLE = { message: "We couldn't open your billing page. Try again in a few minutes." };

function runAction() {
  return action({ request: new Request("https://0509.io/app/settings/billing", { method: "POST" }) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.DODO_PAYMENTS_API_KEY = "key";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("createPortalUrl", () => {
  it("returns the provider's https link and sends the customer back to Settings", async () => {
    mocks.create.mockResolvedValue({ link: "https://billing.example/portal/abc" });
    expect(await createPortalUrl("cus_1")).toBe("https://billing.example/portal/abc");
    expect(mocks.create).toHaveBeenCalledWith("cus_1", { return_url: "https://0509.io/app/settings" });
  });

  it("refuses a link that is not https", async () => {
    mocks.create.mockResolvedValue({ link: "http://billing.example/portal/abc" });
    expect(await createPortalUrl("cus_1")).toBeNull();
    mocks.create.mockResolvedValue({ link: "javascript:alert(1)" });
    expect(await createPortalUrl("cus_1")).toBeNull();
  });

  it("refuses a link that is not a URL", async () => {
    mocks.create.mockResolvedValue({ link: "not a url" });
    await expect(createPortalUrl("cus_1")).resolves.toBeNull();
  });

  it("returns null without calling the provider when the key is missing", async () => {
    mocks.env.DODO_PAYMENTS_API_KEY = "";
    expect(await createPortalUrl("cus_1")).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns null and logs only the status when the provider errors", async () => {
    mocks.create.mockRejectedValue(new DodoPayments.APIError());
    expect(await createPortalUrl("cus_secret")).toBeNull();
    expect(console.error).toHaveBeenCalledWith(JSON.stringify({ event: "billing.portal_failed", status: "500" }));
  });
});

describe("billing action", () => {
  beforeEach(() => {
    mocks.requireFreshSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.readWorkspaceIdForOwner.mockResolvedValue("ws-1");
    mocks.readPlanCustomerId.mockResolvedValue("cus_1");
  });

  it("redirects a paid owner to the provider's page", async () => {
    mocks.create.mockResolvedValue({ link: "https://billing.example/portal/abc" });
    const response = (await runAction()) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://billing.example/portal/abc");
  });

  it("stays on the page when there is no workspace", async () => {
    mocks.readWorkspaceIdForOwner.mockResolvedValue(null);
    expect(await runAction()).toEqual(UNAVAILABLE);
    expect(mocks.readPlanCustomerId).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("stays on the page when the workspace has no customer id", async () => {
    mocks.readPlanCustomerId.mockResolvedValue(null);
    expect(await runAction()).toEqual(UNAVAILABLE);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("stays on the page when the payment key is missing", async () => {
    mocks.env.DODO_PAYMENTS_API_KEY = "";
    expect(await runAction()).toEqual(UNAVAILABLE);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("stays on the page when the provider errors", async () => {
    mocks.create.mockRejectedValue(new DodoPayments.APIError());
    expect(await runAction()).toEqual(UNAVAILABLE);
  });
});
