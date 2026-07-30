import type { AppEnv } from "~/lib/env.server";
import { SupportCaseInputError } from "~/lib/support";
import type {
  SupportCaseRecord,
  SupportCaseStatus,
} from "~/lib/types";
import {
  CustomerAgentActionError,
  readInteger,
  readString,
  type CustomerAgentActionContext,
} from "~/lib/customer-agent-actions/request.server";

export async function createSupportCaseFromAgent(
  env: AppEnv,
  workspaceUserId: string,
  context: CustomerAgentActionContext,
  input: Record<string, unknown>,
) {
  const { createSupportCase } = await import("~/lib/data.server");
  const requestKey = context.idempotencyKey;
  let supportCase;
  try {
    supportCase = await createSupportCase(env, {
      userId: context.userId,
      category: input.category,
      priority: input.priority ?? "normal",
      subject: input.subject,
      detail: input.detail,
      requestKey,
      context: {
        createdFrom: "agent_action",
        source: context.source,
        apiKeyId: context.apiKeyId,
        requesterUserId: context.userId,
        workspaceUserId,
      },
    });
  } catch (error) {
    if (error instanceof SupportCaseInputError) {
      throw new CustomerAgentActionError(error.code, error.message, { status: error.status });
    }
    throw error;
  }

  if (!supportCase) {
    throw new CustomerAgentActionError("support_case_create_failed", "Could not open this support case.", {
      status: 500,
    });
  }
  const requester = await getSupportRequesterProfile(env, context.userId);
  const operatorNotified = await notifySupportCaseOperatorFromAgent(env, {
    caseId: supportCase.id,
    requesterEmail: requester?.email ?? "unknown",
    input,
    source: context.source,
    authorizeExternalEffect: context.authorizeExternalEffect,
  });

  return {
    ok: operatorNotified,
    action: "support_case.create",
    supportCase: safeSupportCaseSummary(supportCase),
    message: operatorNotified
      ? "Support case opened. Support will reply by email."
      : "Support case saved, but support could not be notified. Email support@0509.io now so we can reply.",
  };
}

async function getSupportRequesterProfile(env: AppEnv, userId: string) {
  try {
    const { getUserDeliveryProfile } = await import("~/lib/data.server");
    return await getUserDeliveryProfile(env, userId);
  } catch {
    console.error("[support]", { event: "requester_profile_lookup_failed" });
    return null;
  }
}

async function notifySupportCaseOperatorFromAgent(
  env: AppEnv,
  input: {
    caseId: string;
    requesterEmail: string;
    input: Record<string, unknown>;
    source: CustomerAgentActionContext["source"];
    authorizeExternalEffect?: CustomerAgentActionContext["authorizeExternalEffect"];
  },
) {
  const idempotencyKey = `support-case:${input.caseId}`;
  try {
    const { getDeliveryAttemptByIdempotencyKey } = await import("~/lib/data.server");
    const existingAttempt = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
    if (existingAttempt?.status === "sent") {
      return true;
    }

    const { SUPPORT_CASE_CATEGORY_LABELS, SUPPORT_CASE_PRIORITY_LABELS, normalizeSupportCaseInput } = await import("~/lib/support");
    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    const normalized = normalizeSupportCaseInput({
      category: input.input.category,
      priority: input.input.priority ?? "normal",
      subject: input.input.subject,
      detail: input.input.detail,
    });

    await input.authorizeExternalEffect?.();

    return await sendOperatorAlertEmail(env, {
      subject: `0509 support case: ${normalized.subject}`,
      lines: [
        `Case: ${input.caseId}`,
        `Requester: ${input.requesterEmail}`,
        `Source: ${input.source}`,
        `Category: ${SUPPORT_CASE_CATEGORY_LABELS[normalized.category]}`,
        `Priority: ${SUPPORT_CASE_PRIORITY_LABELS[normalized.priority]}`,
        `Subject: ${normalized.subject}`,
        `Details: ${normalized.detail}`,
      ],
      idempotencyKey,
    });
  } catch {
    console.error("[support]", { event: "agent_operator_alert_failed" });
    return false;
  }
}

export async function listSupportCasesFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const { listSupportCases } = await import("~/lib/data.server");
  const status = readOptionalSupportCaseStatus(input) ?? "all";
  const cases = await listSupportCases(env, userId, {
    status,
    limit: readInteger(input, "limit", 20),
  });

  return {
    ok: true,
    action: "support_case.list",
    status,
    cases: cases.map(safeSupportCaseSummary),
  };
}

function safeSupportCaseSummary(supportCase: SupportCaseRecord) {
  return {
    id: supportCase.id,
    category: supportCase.category,
    priority: supportCase.priority,
    status: supportCase.status,
    subject: supportCase.subject,
    createdAt: supportCase.createdAt,
    updatedAt: supportCase.updatedAt,
  };
}

function readOptionalSupportCaseStatus(input: Record<string, unknown>): SupportCaseStatus | "all" | null {
  const value = readString(input, "status");
  if (!value) {
    return null;
  }
  if (value === "open" || value === "closed" || value === "all") {
    return value;
  }
  throw new CustomerAgentActionError("invalid_support_case_status", "status must be open, closed, or all.");
}
