import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import type {
  CostEstimate,
  HealthCheckResult,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

export const xConnector = {
  id: "x" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return { units: 5, description: "Official X API read (budget-guarded)" };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "x", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "X connector is not available.",
      };
    }

    const handle = normalizeHandle(input.targetHandle ?? input.targetUrl);
    if (!handle) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_handle",
        errorMessage: "Enter an X handle, like @brand.",
      };
    }

    return {
      ok: true,
      targetKey: handle,
      targetHandle: handle,
      coverageLabel: input.trackingMode === "self" ? "CONNECTED_ACCOUNT" : "OFFICIAL_PUBLIC_API",
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "x", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "X connector is gated.",
        errorCode: gate.reasonCode,
      };
    }
    return {
      ok: true,
      status: "healthy",
      summary: "X API credentials configured.",
    };
  },

  async poll(ctx: PresenceConnectorContext): Promise<PollResult> {
    if (ctx.env.PRESENCE_X_MOCK === "1") {
      const now = new Date().toISOString();
      return {
        ok: true,
        items: [
          {
            externalId: "mock-x-1",
            canonicalUrl: "https://x.com/example/status/mock",
            title: "Mock X post",
            bodyExcerpt: "Presence tracking mock item for tests.",
            author: "@example",
            publishedAt: now,
            observedAt: now,
            contentHash: "mock",
          },
        ],
        costUnits: 0,
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "x", ctx.trackingMode);
    return {
      ok: false,
      items: [],
      errorCode: gate.reasonCode ?? "connector_disabled",
      errorMessage: gate.reasonMessage ?? "X connector is not enabled.",
    };
  },
};

function normalizeHandle(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(trimmed) ? trimmed : null;
}
