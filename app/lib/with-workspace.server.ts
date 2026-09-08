import type { AppEnv } from "~/lib/env.server";
import type { WorkspaceSession } from "~/lib/auth.server";
import type { PlanFamily, PlanResource } from "~/lib/plan-entitlements";

/**
 * Route guard that composes requireWorkspaceSession + getUserPlan (+ optional
 * checkPlanLimit). Call sites that only need auth keep using requireWorkspaceSession;
 * use this when the handler also needs plan context or a count-limit gate.
 */

export type PlanLimitExceededActionResult = {
  ok: false;
  error: "plan_limit_exceeded";
  limit: number;
  current: number;
  message: string;
  upgradePath?: string;
};

export type PlanLimitInfo = {
  allowed: boolean;
  limit: number;
  current: number;
};

export type WithWorkspaceOptions = {
  /** When set, checkPlanLimit for this resource and deny when current >= limit. */
  requirePlan?: PlanResource;
  /** Override the canonical limit-exceeded message (string or from limit info). */
  limitMessage?: string | ((info: PlanLimitInfo & { plan: PlanFamily }) => string);
  /** Optional billing upgrade path included on the action result. */
  upgradePath?: string;
};

export type WithWorkspaceOk = WorkspaceSession & {
  ok: true;
  plan: PlanFamily;
  /** Present when requirePlan was set and the limit check passed. */
  planLimit: PlanLimitInfo | null;
};

export type WithWorkspaceDenied = {
  ok: false;
  plan: PlanFamily;
  planLimit: PlanLimitInfo;
  result: PlanLimitExceededActionResult;
  /** Canonical 402 JSON response for API / non-form callers. */
  response: Response;
};

export type WithWorkspaceResult = WithWorkspaceOk | WithWorkspaceDenied;

const DEFAULT_LIMIT_MESSAGES: Record<PlanResource, string> = {
  watchlists: "You've reached your competitor tracking limit.",
  collections: "You've reached your collection limit.",
};

export function defaultPlanLimitMessage(resource: PlanResource): string {
  return DEFAULT_LIMIT_MESSAGES[resource];
}

export function planLimitExceededActionResult(input: {
  limit: number;
  current: number;
  message: string;
  upgradePath?: string;
}): PlanLimitExceededActionResult {
  return {
    ok: false,
    error: "plan_limit_exceeded",
    limit: input.limit,
    current: input.current,
    message: input.message,
    ...(input.upgradePath ? { upgradePath: input.upgradePath } : {}),
  };
}

export function planLimitExceededResponse(input: {
  limit: number;
  current: number;
  message: string;
  upgradePath?: string;
  plan?: PlanFamily;
}): Response {
  return Response.json(
    {
      error: "plan_limit_exceeded",
      limit: input.limit,
      current: input.current,
      message: input.message,
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.upgradePath ? { upgradePath: input.upgradePath } : {}),
    },
    {
      status: 402,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function resolveLimitMessage(
  resource: PlanResource,
  info: PlanLimitInfo & { plan: PlanFamily },
  limitMessage: WithWorkspaceOptions["limitMessage"],
): string {
  if (typeof limitMessage === "function") {
    return limitMessage(info);
  }
  if (typeof limitMessage === "string") {
    return limitMessage;
  }
  return defaultPlanLimitMessage(resource);
}

/**
 * Resolve the workspace session and plan. When `requirePlan` is set and the
 * count limit is exceeded, returns a denied result with both the form-action
 * shape and a 402 Response — callers pick which to return.
 */
export async function withWorkspace(
  request: Request,
  env: AppEnv,
  options: WithWorkspaceOptions = {},
): Promise<WithWorkspaceResult> {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const planServer = await import("~/lib/plan.server");

  const workspace = await requireWorkspaceSession(env, request);
  const plan = await planServer.getUserPlan(env, workspace.workspaceUserId);

  if (!options.requirePlan) {
    return {
      ok: true,
      ...workspace,
      plan,
      planLimit: null,
    };
  }

  const planLimit = await planServer.checkPlanLimit(
    env,
    workspace.workspaceUserId,
    options.requirePlan,
  );
  if (planLimit.allowed) {
    return {
      ok: true,
      ...workspace,
      plan,
      planLimit,
    };
  }

  const message = resolveLimitMessage(
    options.requirePlan,
    { ...planLimit, plan },
    options.limitMessage,
  );
  const result = planLimitExceededActionResult({
    limit: planLimit.limit,
    current: planLimit.current,
    message,
    upgradePath: options.upgradePath,
  });

  return {
    ok: false,
    plan,
    planLimit,
    result,
    response: planLimitExceededResponse({
      limit: planLimit.limit,
      current: planLimit.current,
      message,
      upgradePath: options.upgradePath,
      plan,
    }),
  };
}

/**
 * Count-limit gate for handlers that already resolved the workspace (e.g. after
 * withWorkspace without requirePlan, or mid-action after other validation).
 */
export async function requireWorkspacePlanLimit(
  env: AppEnv,
  workspaceUserId: string,
  resource: PlanResource,
  options: Omit<WithWorkspaceOptions, "requirePlan"> = {},
): Promise<
  | { ok: true; plan: PlanFamily; planLimit: PlanLimitInfo }
  | {
      ok: false;
      plan: PlanFamily;
      planLimit: PlanLimitInfo;
      result: PlanLimitExceededActionResult;
      response: Response;
    }
> {
  const planServer = await import("~/lib/plan.server");
  const [plan, planLimit] = await Promise.all([
    planServer.getUserPlan(env, workspaceUserId),
    planServer.checkPlanLimit(env, workspaceUserId, resource),
  ]);

  if (planLimit.allowed) {
    return { ok: true, plan, planLimit };
  }

  const message = resolveLimitMessage(resource, { ...planLimit, plan }, options.limitMessage);
  const result = planLimitExceededActionResult({
    limit: planLimit.limit,
    current: planLimit.current,
    message,
    upgradePath: options.upgradePath,
  });

  return {
    ok: false,
    plan,
    planLimit,
    result,
    response: planLimitExceededResponse({
      limit: planLimit.limit,
      current: planLimit.current,
      message,
      upgradePath: options.upgradePath,
      plan,
    }),
  };
}
