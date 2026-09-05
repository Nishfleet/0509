import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-06-20T00:00:00.000Z",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-06-21T00:00:00.000Z",
  },
};

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function mockAuth(options: { workspaceUserId?: string; operatorNotified?: boolean } = {}) {
  const sendOperatorAlertEmail = vi.fn().mockResolvedValue(options.operatorNotified ?? true);
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn(async () => ({
      session,
      workspaceUserId: options.workspaceUserId ?? session.user.id,
      isMember: Boolean(options.workspaceUserId && options.workspaceUserId !== session.user.id),
      ownerName: options.workspaceUserId && options.workspaceUserId !== session.user.id ? "Owner" : null,
    })),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn((context) => context.cloudflare.env),
  }));
  vi.doMock("~/lib/delivery.server", () => ({
    sendOperatorAlertEmail,
  }));

  return { sendOperatorAlertEmail };
}

function mockDataServer(overrides: Record<string, unknown>) {
  const getDeliveryAttemptByIdempotencyKey =
    overrides.getDeliveryAttemptByIdempotencyKey ?? vi.fn().mockResolvedValue(null);
  const getSupportCase = overrides.getSupportCase ?? vi.fn().mockResolvedValue(null);
  const listSupportCaseEvents = overrides.listSupportCaseEvents ?? vi.fn().mockResolvedValue([]);
  const createSupportCaseEvent = overrides.createSupportCaseEvent ?? vi.fn().mockResolvedValue({
    id: "support-case-event-1",
  });

  vi.doMock("~/lib/data.server", () => ({
    createSupportCaseEvent,
    getDeliveryAttemptByIdempotencyKey,
    getSupportCase,
    listSupportCaseEvents,
    ...overrides,
  }));

  return {
    createSupportCaseEvent,
    getDeliveryAttemptByIdempotencyKey,
    getSupportCase,
    listSupportCaseEvents,
  };
}

async function mockRouter(loaderData: unknown, actionData?: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(actionData),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("support route", () => {
  it("loads account-scoped cases and honors a category deep link", async () => {
    mockAuth({ workspaceUserId: "owner-1" });
    const listSupportCases = vi.fn().mockResolvedValue([
      {
        id: "case-1",
        userId: "user-1",
        category: "billing",
        priority: "normal",
        status: "open",
        subject: "Need invoice",
        detail: "Private invoice detail should not go to the list payload.",
        context: { accountEmail: "owner@example.com" },
        createdAt: "2026-06-20T10:00:00.000Z",
        updatedAt: "2026-06-20T10:00:00.000Z",
      },
    ]);
    mockDataServer({ listSupportCases });

    const { loader } = await import("~/routes/app.support");
    const result = await loader({
      context: createContext(),
      request: new Request("https://0509.io/app/support?category=billing"),
      params: {},
    } as never);

    expect(result).toMatchObject({
      email: "owner@example.com",
      selectedCategory: "billing",
      isWorkspaceMember: true,
      cases: [
        {
          id: "case-1",
          category: "billing",
          priority: "normal",
          status: "open",
          subject: "Need invoice",
          createdAt: "2026-06-20T10:00:00.000Z",
          updatedAt: "2026-06-20T10:00:00.000Z",
        },
      ],
    });
    expect(listSupportCases).toHaveBeenCalledWith({}, "user-1", { status: "all", limit: 20 });
    expect(JSON.stringify(result)).not.toContain("Private invoice detail");
    expect(JSON.stringify(result)).not.toContain("accountEmail");
  });

  it("loads a selected case with its customer-visible event trail", async () => {
    mockAuth();
    const listSupportCases = vi.fn().mockResolvedValue([
      {
        id: "case-1",
        userId: "user-1",
        category: "billing",
        priority: "urgent",
        status: "open",
        subject: "Need invoice",
        detail: "Private invoice detail stays out of the summary list.",
        context: { accountEmail: "owner@example.com" },
        createdAt: "2026-06-20T10:00:00.000Z",
        updatedAt: "2026-06-20T10:00:00.000Z",
      },
    ]);
    const getSupportCase = vi.fn().mockResolvedValue({
      id: "case-1",
      userId: "user-1",
      category: "billing",
      priority: "urgent",
      status: "open",
      subject: "Need invoice",
      detail: "Please send the invoice to finance.",
      context: { accountEmail: "owner@example.com" },
      createdAt: "2026-06-20T10:00:00.000Z",
      updatedAt: "2026-06-20T10:00:00.000Z",
    });
    const listSupportCaseEvents = vi.fn().mockResolvedValue([
      {
        id: "event-1",
        caseId: "case-1",
        userId: "user-1",
        eventType: "case_opened",
        message: "Support case opened from the signed-in support form.",
        visibleToCustomer: true,
        metadata: {},
        createdAt: "2026-06-20T10:00:00.000Z",
      },
    ]);
    mockDataServer({ getSupportCase, listSupportCaseEvents, listSupportCases });

    const { loader } = await import("~/routes/app.support");
    const result = await loader({
      context: createContext(),
      request: new Request("https://0509.io/app/support?case=case-1"),
      params: {},
    } as never);

    expect(result).toMatchObject({
      selectedCase: {
        id: "case-1",
        detail: "Please send the invoice to finance.",
      },
      caseEvents: [
        {
          id: "event-1",
          eventType: "case_opened",
          message: "Support case opened from the signed-in support form.",
        },
      ],
      requestedCaseMissing: false,
    });
    expect(getSupportCase).toHaveBeenCalledWith({}, "user-1", "case-1");
    expect(listSupportCaseEvents).toHaveBeenCalledWith({}, "user-1", "case-1", { limit: 30 });
  });

  it("creates a support case for the workspace owner", async () => {
    const { sendOperatorAlertEmail } = mockAuth({ operatorNotified: true });
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-1" });
    const createSupportCaseEvent = vi.fn().mockResolvedValue({ id: "event-1" });
    mockDataServer({ createSupportCase, createSupportCaseEvent });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "billing");
    formData.set("priority", "urgent");
    formData.set("requestKey", "support-request-1");
    formData.set("subject", "Cancel Starter at period end");
    formData.set("detail", "Please cancel renewal but keep access through the paid period.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      caseId: "case-1",
      message: "Support case opened and support was notified. We'll reply by email.",
    });
    expect(createSupportCase).toHaveBeenCalledWith({}, {
      userId: "user-1",
      category: "billing",
      priority: "urgent",
      subject: "Cancel Starter at period end",
      detail: "Please cancel renewal but keep access through the paid period.",
      requestKey: "support-request-1",
      context: {
        accountEmail: "owner@example.com",
        createdFrom: "signed_in_support",
        workspaceUserId: "user-1",
      },
    });
    expect(sendOperatorAlertEmail).toHaveBeenCalledWith({}, expect.objectContaining({
      subject: "0509 support case: Cancel Starter at period end",
      idempotencyKey: "support-case:case-1",
      lines: expect.arrayContaining([
        "Case: case-1",
        "Requester: owner@example.com",
        "Category: Billing, cancellation, or invoice",
        "Priority: Urgent",
      ]),
    }));
    expect(createSupportCaseEvent).toHaveBeenCalledWith({}, expect.objectContaining({
      caseId: "case-1",
      userId: "user-1",
      eventType: "support_notified",
      message: "Support was notified by email.",
      visibleToCustomer: true,
    }));
  });

  it("does not resend operator alerts for duplicate support submissions after a sent attempt", async () => {
    const { sendOperatorAlertEmail } = mockAuth();
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-1", alreadyExists: true });
    const getDeliveryAttemptByIdempotencyKey = vi.fn().mockResolvedValue({ status: "sent" });
    const createSupportCaseEvent = vi.fn();
    mockDataServer({ createSupportCase, createSupportCaseEvent, getDeliveryAttemptByIdempotencyKey });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "delivery");
    formData.set("requestKey", "support-request-1");
    formData.set("subject", "Digest did not arrive");
    formData.set("detail", "Please check the digest delivery trail.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      caseId: "case-1",
      message: "Support case opened and support was notified. We'll reply by email.",
    });
    expect(createSupportCase).toHaveBeenCalledWith({}, expect.objectContaining({
      requestKey: "support-request-1",
    }));
    expect(getDeliveryAttemptByIdempotencyKey).toHaveBeenCalledWith({}, "support-case:case-1");
    expect(sendOperatorAlertEmail).not.toHaveBeenCalled();
    expect(createSupportCaseEvent).toHaveBeenCalledWith({}, expect.objectContaining({
      caseId: "case-1",
      eventType: "support_notified",
      idempotencyKey: "support-notification:case-1:sent",
    }));
  });

  it("re-reads the durable attempt instead of reporting a false failure after a concurrent send", async () => {
    mockAuth({ operatorNotified: false });
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-1" });
    const createSupportCaseEvent = vi.fn().mockResolvedValue({ id: "event-1" });
    const getDeliveryAttemptByIdempotencyKey = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "sent", webhookStatus: "delivered" });
    mockDataServer({
      createSupportCase,
      createSupportCaseEvent,
      getDeliveryAttemptByIdempotencyKey,
    });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "delivery");
    formData.set("subject", "Digest did not arrive");
    formData.set("detail", "Please check the digest delivery trail.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", { method: "POST", body: formData }),
    } as never);

    expect(result).toMatchObject({ ok: true, caseId: "case-1" });
    expect(createSupportCaseEvent).toHaveBeenCalledWith({}, expect.objectContaining({
      eventType: "support_notified",
      idempotencyKey: "support-notification:case-1:sent",
    }));
    expect(createSupportCaseEvent).not.toHaveBeenCalledWith({}, expect.objectContaining({
      eventType: "support_notification_failed",
    }));
  });

  it("reports an active or provider-unknown claim without recording a false failed event", async () => {
    mockAuth({ operatorNotified: false });
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-1" });
    const createSupportCaseEvent = vi.fn();
    const getDeliveryAttemptByIdempotencyKey = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "pending", webhookStatus: "provider_unknown" });
    mockDataServer({
      createSupportCase,
      createSupportCaseEvent,
      getDeliveryAttemptByIdempotencyKey,
    });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "delivery");
    formData.set("subject", "Digest did not arrive");
    formData.set("detail", "Please check the digest delivery trail.");
    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", { method: "POST", body: formData }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Support case saved, but the email provider outcome is not confirmed. Email support@0509.io now if the request is urgent.",
      caseId: "case-1",
    });
    expect(createSupportCaseEvent).not.toHaveBeenCalled();
  });

  it("retries operator alerts for duplicate support submissions after a failed attempt", async () => {
    const { sendOperatorAlertEmail } = mockAuth();
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-1", alreadyExists: true });
    const getDeliveryAttemptByIdempotencyKey = vi.fn().mockResolvedValue({ status: "failed" });
    mockDataServer({ createSupportCase, getDeliveryAttemptByIdempotencyKey });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "delivery");
    formData.set("requestKey", "support-request-1");
    formData.set("subject", "Digest did not arrive");
    formData.set("detail", "Please check the digest delivery trail.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: true, caseId: "case-1" });
    expect(sendOperatorAlertEmail).toHaveBeenCalledWith({}, expect.objectContaining({
      idempotencyKey: "support-case:case-1",
    }));
  });

  it("does not claim a support case is opened when operator notification fails", async () => {
    mockAuth({ operatorNotified: false });
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-1" });
    const createSupportCaseEvent = vi.fn().mockResolvedValue({ id: "event-1" });
    mockDataServer({ createSupportCase, createSupportCaseEvent });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "delivery");
    formData.set("subject", "Digest did not arrive");
    formData.set("detail", "Please check the digest delivery trail.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Support case saved, but we could not notify support. Email support@0509.io now so we can reply.",
      caseId: "case-1",
    });
    expect(createSupportCaseEvent).toHaveBeenCalledWith({}, expect.objectContaining({
      caseId: "case-1",
      eventType: "support_notification_failed",
      message: "Automatic support notification failed. Email support@0509.io now so we can reply.",
    }));
  });

  it("does not claim a support case is opened when operator notification rejects", async () => {
    const { sendOperatorAlertEmail } = mockAuth();
    sendOperatorAlertEmail.mockRejectedValue(new Error("email unavailable"));
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-1" });
    const createSupportCaseEvent = vi.fn().mockResolvedValue({ id: "event-1" });
    mockDataServer({ createSupportCase, createSupportCaseEvent });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "delivery");
    formData.set("subject", "Digest did not arrive");
    formData.set("detail", "Please check the digest delivery trail.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Support case saved, but we could not notify support. Email support@0509.io now so we can reply.",
      caseId: "case-1",
    });
    expect(createSupportCaseEvent).toHaveBeenCalledWith({}, expect.objectContaining({
      caseId: "case-1",
      eventType: "support_notification_failed",
    }));
  });

  it("returns an email fallback when support case persistence fails", async () => {
    mockAuth();
    const createSupportCase = vi.fn().mockRejectedValue(new Error("D1 unavailable"));
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "delivery");
    formData.set("subject", "Digest did not arrive");
    formData.set("detail", "Please check the digest delivery trail.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Support case could not be saved. Email support@0509.io now so we can reply.",
    });
  });

  it("blocks workspace members from opening owner-authority billing cases", async () => {
    mockAuth({ workspaceUserId: "owner-1" });
    const createSupportCase = vi.fn();
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "billing");
    formData.set("subject", "Cancel the workspace");
    formData.set("detail", "Please cancel this paid workspace.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Ask the account owner to open cancellation, plan-change, or team-seat requests.",
    });
    expect(createSupportCase).not.toHaveBeenCalled();
  });

  it("blocks workspace members from opening owner-authority team cases", async () => {
    mockAuth({ workspaceUserId: "owner-1" });
    const createSupportCase = vi.fn();
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "team");
    formData.set("subject", "Remove a teammate");
    formData.set("detail", "Please remove a teammate from the workspace.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Ask the account owner to open cancellation, plan-change, or team-seat requests.",
    });
    expect(createSupportCase).not.toHaveBeenCalled();
  });

  it("blocks workspace members from hiding owner-authority requests under another category", async () => {
    mockAuth({ workspaceUserId: "owner-1" });
    const createSupportCase = vi.fn();
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "other");
    formData.set("subject", "Cancel this workspace");
    formData.set("detail", "Please cancel renewal for this paid workspace.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Ask the account owner to open cancellation, plan-change, or team-seat requests.",
    });
    expect(createSupportCase).not.toHaveBeenCalled();
  });

  it("allows workspace members to open personal billing and invoice cases", async () => {
    mockAuth({ workspaceUserId: "owner-1" });
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-invoice" });
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "billing");
    formData.set("subject", "Need invoice copy");
    formData.set("detail", "Please send a copy of my latest invoice for my records.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: true, caseId: "case-invoice" });
    expect(createSupportCase).toHaveBeenCalledWith({}, expect.objectContaining({
      userId: "user-1",
      category: "billing",
      subject: "Need invoice copy",
      context: expect.objectContaining({
        workspaceUserId: "owner-1",
      }),
    }));
  });

  it("allows workspace members to open personal billing cancellation cases", async () => {
    mockAuth({ workspaceUserId: "owner-1" });
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-cancel" });
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "billing");
    formData.set("subject", "Cancel Starter at period end");
    formData.set("detail", "Please cancel my personal plan renewal but keep access through the paid period.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: true, caseId: "case-cancel" });
    expect(createSupportCase).toHaveBeenCalledWith({}, expect.objectContaining({
      userId: "user-1",
      category: "billing",
      subject: "Cancel Starter at period end",
      context: expect.objectContaining({
        workspaceUserId: "owner-1",
      }),
    }));
  });

  it("allows workspace members to open non-owner-authority support cases", async () => {
    mockAuth({ workspaceUserId: "owner-1" });
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-2" });
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "delivery");
    formData.set("subject", "Digest did not arrive");
    formData.set("detail", "Please check the digest delivery trail.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: true, caseId: "case-2" });
    expect(createSupportCase).toHaveBeenCalledWith({}, expect.objectContaining({
      userId: "user-1",
      category: "delivery",
      context: expect.objectContaining({
        workspaceUserId: "owner-1",
      }),
    }));
  });

  it("allows workspace members to open personal security and deletion cases", async () => {
    mockAuth({ workspaceUserId: "owner-1" });
    const createSupportCase = vi.fn().mockResolvedValue({ id: "case-3" });
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "security");
    formData.set("subject", "Delete my personal account");
    formData.set("detail", "Please start deletion for my login.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: true, caseId: "case-3" });
    expect(createSupportCase).toHaveBeenCalledWith({}, expect.objectContaining({
      userId: "user-1",
      category: "security",
      context: expect.objectContaining({
        workspaceUserId: "owner-1",
      }),
    }));
  });

  it("rejects invalid submitted categories instead of silently rerouting", async () => {
    mockAuth();
    const createSupportCase = vi.fn();
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "refund-now");
    formData.set("subject", "Need help");
    formData.set("detail", "Please route this correctly.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({ ok: false, message: "Choose a valid support category." });
    expect(createSupportCase).not.toHaveBeenCalled();
  });

  it("rejects secret-like details before persistence", async () => {
    mockAuth();
    const createSupportCase = vi.fn();
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "delivery");
    formData.set("subject", "Slack delivery is failing");
    formData.set("detail", "https://hooks.slack.com/services/T/B/C");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Support cases cannot contain secrets, tokens, webhook URLs, card numbers, or private credentials.",
    });
    expect(createSupportCase).not.toHaveBeenCalled();
  });

  it("rejects card-like details before persistence", async () => {
    mockAuth();
    const createSupportCase = vi.fn();
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "billing");
    formData.set("subject", "Billing card issue");
    formData.set("detail", "The card was 4242 4242 4242 4242.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Support cases cannot contain secrets, tokens, webhook URLs, card numbers, or private credentials.",
    });
    expect(createSupportCase).not.toHaveBeenCalled();
  });

  it("rejects card-like details with common separators before persistence", async () => {
    mockAuth();
    const createSupportCase = vi.fn();
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "billing");
    formData.set("subject", "Billing card issue");
    formData.set("detail", "The card was 4242.4242/4242\t4242.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Support cases cannot contain secrets, tokens, webhook URLs, card numbers, or private credentials.",
    });
    expect(createSupportCase).not.toHaveBeenCalled();
  });

  it("rejects comma-separated card-like details before persistence", async () => {
    mockAuth();
    const createSupportCase = vi.fn();
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "billing");
    formData.set("subject", "Billing card issue");
    formData.set("detail", "The card was 4242, 4242, 4242, 4242.");

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Support cases cannot contain secrets, tokens, webhook URLs, card numbers, or private credentials.",
    });
    expect(createSupportCase).not.toHaveBeenCalled();
  });

  it("rejects non-text support form values before persistence", async () => {
    mockAuth();
    const createSupportCase = vi.fn();
    mockDataServer({ createSupportCase });

    const { action } = await import("~/routes/app.support");
    const formData = new FormData();
    formData.set("intent", "create-support-case");
    formData.set("category", "billing");
    formData.set("subject", "Billing help");
    formData.set("detail", new File(["hello"], "detail.txt", { type: "text/plain" }));

    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/support", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({ ok: false, message: "Add the details you want support to see." });
    expect(createSupportCase).not.toHaveBeenCalled();
  });

  it("renders the form, case history, and billing truth", async () => {
    await mockRouter({
      email: "owner@example.com",
      supportEmail: "support@0509.io",
      supportRequestKey: "support-request-render-1",
      selectedCategory: "billing",
      isWorkspaceMember: false,
      cases: [
        {
          id: "case-1",
          userId: "user-1",
          category: "billing",
          priority: "urgent",
          status: "open",
          subject: "Cancel Starter at period end",
          detail: "Please cancel renewal.",
          context: {},
          createdAt: "2026-06-20T10:00:00.000Z",
          updatedAt: "2026-06-20T10:00:00.000Z",
        },
      ],
    });

    const { default: SupportRoute } = await import("~/routes/app.support");
    const markup = renderToStaticMarkup(createElement(SupportRoute));

    expect(markup).toContain("Get account help without losing the trail.");
    expect(markup).toContain("Cancel Starter at period end");
    expect(markup).toContain("Billing, cancellation, or invoice");
    expect(markup).toContain("Open support case");
    expect(markup).toContain("name=\"requestKey\"");
    expect(markup).toContain("value=\"support-request-render-1\"");
    expect(markup).toContain("Plan changes start from the billing page");
    expect(markup).toContain("support@0509.io");
  });

  it("announces support action recovery without exposing raw errors", async () => {
    await mockRouter({
      email: "owner@example.com",
      supportEmail: "support@0509.io",
      supportRequestKey: "support-request-render-2",
      selectedCategory: "other",
      isWorkspaceMember: false,
      cases: [],
      selectedCase: null,
      caseEvents: [],
      requestedCaseMissing: false,
    }, {
      ok: false,
      message: "Support case saved and notification is still being confirmed.",
    });

    const { default: SupportRoute } = await import("~/routes/app.support");
    const markup = renderToStaticMarkup(createElement(SupportRoute));

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-live="assertive"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).not.toContain("raw provider failure");
  });
});
