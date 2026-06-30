import {
  Form,
  Link,
  useActionData,
  useLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { sanitizeCustomerFacingMessage } from "~/lib/customer-route-error";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import type { AppEnv } from "~/lib/env.server";
import {
  SUPPORT_CASE_CATEGORIES,
  SUPPORT_CASE_CATEGORY_LABELS,
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_PRIORITY_LABELS,
  SUPPORT_CASE_STATUS_LABELS,
  SUPPORT_CASE_EVENT_LABELS,
  SUPPORT_CASE_DETAIL_MAX_LENGTH,
  SUPPORT_CASE_SUBJECT_MAX_LENGTH,
  SupportCaseInputError,
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
  normalizeSupportCaseInput,
  readSupportCaseCategory,
} from "~/lib/support";
import type {
  SupportCaseCategory,
  SupportCaseEventType,
  SupportCasePriority,
  SupportCaseStatus,
} from "~/lib/types";

const OWNER_ONLY_SUPPORT_CATEGORIES = new Set<SupportCaseCategory>(["team"]);
const BILLING_CHANGE_TEXT_PATTERN =
  /\b(?:cancel(?:led|lation|ling)?|renewal|change\s+plan|switch\s+plan|upgrade|downgrade|plan\s+(?:change|switch|upgrade|downgrade)|subscription\s+(?:change|switch|upgrade|downgrade|cancel(?:led|lation|ling)?))\b/i;
const WORKSPACE_AUTHORITY_TEXT_PATTERN = /\b(?:workspace|agency|team|seat|teammate|team\s+member|workspace\s+user)\b/i;
const TEAM_AUTHORITY_TEXT_PATTERNS = [
  /\b(?:add|remove|invite|deactivate)\s+(?:a\s+)?(?:teammate|team\s+member|seat|workspace\s+user)\b/i,
  /\bteam\s+seat\b/i,
];

export const meta = () => [{ title: "Support | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Help & support" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getSupportCase, listSupportCaseEvents, listSupportCases } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const url = new URL(request.url);
  const selectedCategory = readSupportCaseCategory(url.searchParams.get("category")) ?? "other";
  const selectedCaseId = readSelectedCaseId(url.searchParams.get("case"));
  const cases = await listSupportCases(env, session.user.id, { status: "all", limit: 20 });
  const selectedCase = selectedCaseId
    ? await getSupportCase(env, session.user.id, selectedCaseId)
    : null;
  const caseEvents = selectedCase
    ? await listSupportCaseEvents(env, session.user.id, selectedCase.id, { limit: 30 })
    : [];

  return {
    email: session.user.email,
    cases: cases.map(toSupportCaseSummary),
    selectedCase: selectedCase ? toSupportCaseDetail(selectedCase) : null,
    caseEvents: caseEvents.map(toSupportCaseEventSummary),
    requestedCaseMissing: Boolean(selectedCaseId && !selectedCase),
    selectedCategory,
    supportEmail: SUPPORT_EMAIL,
    supportRequestKey: crypto.randomUUID(),
    isWorkspaceMember: workspaceUserId !== session.user.id,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { createSupportCase, createSupportCaseEvent } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent !== "create-support-case") {
    return { ok: false, message: "Unknown support action." };
  }

  let input;
  try {
    input = normalizeSupportCaseInput({
      category: formData.get("category"),
      priority: formData.get("priority"),
      subject: formData.get("subject"),
      detail: formData.get("detail"),
    });
  } catch (error) {
    if (error instanceof SupportCaseInputError) {
      return { ok: false, message: sanitizeCustomerFacingMessage(error.message) };
    }
    console.error("[support] case persistence failed", error);
    return {
      ok: false,
      message: `Support case could not be saved. Email ${SUPPORT_EMAIL} now so we can reply.`,
    };
  }

  const isWorkspaceMember = workspaceUserId !== session.user.id;
  if (isWorkspaceMember && requiresWorkspaceOwnerAuthority(input)) {
    return {
      ok: false,
      message: "Ask the account owner to open cancellation, plan-change, or team-seat requests.",
    };
  }

  let supportCase;
  const requestKeyValue = formData.get("requestKey");
  try {
    supportCase = await createSupportCase(env, {
      userId: session.user.id,
      category: input.category,
      priority: input.priority,
      subject: input.subject,
      detail: input.detail,
      requestKey: typeof requestKeyValue === "string" ? requestKeyValue : null,
      context: {
        accountEmail: session.user.email,
        createdFrom: "signed_in_support",
        workspaceUserId,
      },
    });
  } catch (error) {
    if (error instanceof SupportCaseInputError) {
      return { ok: false, message: sanitizeCustomerFacingMessage(error.message) };
    }
    console.error("[support] case persistence failed", error);
    return {
      ok: false,
      message: `Support case could not be saved. Email ${SUPPORT_EMAIL} now so we can reply.`,
    };
  }

  if (!supportCase) {
    return { ok: false, message: "Support case could not be opened." };
  }

  const operatorNotification = await notifySupportCaseOperator(env, {
    caseId: supportCase.id,
    requesterEmail: session.user.email,
    input,
    isWorkspaceMember,
  });

  if (operatorNotification !== "already_sent") {
    try {
      await createSupportCaseEvent(env, {
        caseId: supportCase.id,
        userId: session.user.id,
        eventType: operatorNotification === "sent" ? "support_notified" : "support_notification_failed",
        message: operatorNotification === "sent"
          ? "Support was notified by email."
          : `Automatic support notification failed. Email ${SUPPORT_EMAIL} now so we can reply.`,
        visibleToCustomer: true,
        metadata: {
          channel: "email",
          createdFrom: "signed_in_support",
        },
      });
    } catch (error) {
      console.error("[support] case event persistence failed", error);
    }
  }

  if (operatorNotification === "failed") {
    return {
      ok: false,
      message: `Support case saved, but we could not notify support. Email ${SUPPORT_EMAIL} now so we can reply.`,
      caseId: supportCase.id,
    };
  }

  return {
    ok: true,
    message: "Support case opened and support was notified. We'll reply by email.",
    caseId: supportCase.id,
  };
}

export default function SupportRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          lead="Get account help without losing the trail."
          title="Help & support"
        />

      {actionData?.message ? (
        <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
          <p>{actionData.message}</p>
        </div>
      ) : null}

      <p className="f9-action-row">
        <a className="f9-secondary-button" href={SUPPORT_MAILTO}>
          Email support
        </a>
      </p>

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel f9-side-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Open a case</span>
              <h2>Tell us what needs attention.</h2>
            </div>
          </div>

          <Form className="f9-auth-form" method="post">
            <input name="intent" type="hidden" value="create-support-case" />
            <input name="requestKey" type="hidden" value={data.supportRequestKey} />
            <label className="f9-field">
              <span>Category</span>
              <select name="category" defaultValue={data.selectedCategory}>
                {SUPPORT_CASE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {SUPPORT_CASE_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </label>
            <label className="f9-field">
              <span>Priority</span>
              <select name="priority" defaultValue="normal">
                {SUPPORT_CASE_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {SUPPORT_CASE_PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </label>
            <label className="f9-field">
              <span>Subject</span>
              <input
                name="subject"
                maxLength={SUPPORT_CASE_SUBJECT_MAX_LENGTH}
                placeholder="Cancel Starter at period end"
                required
              />
            </label>
            <label className="f9-field">
              <span>Details</span>
              <textarea
                name="detail"
                maxLength={SUPPORT_CASE_DETAIL_MAX_LENGTH}
                placeholder="What should we change, check, or confirm?"
                required
                rows={6}
              />
            </label>
            <p className="f9-app-muted">
              Do not paste passwords, private keys, webhook URLs, card numbers, or provider tokens.
            </p>
            <SubmitButton className="f9-primary-button" intent="create-support-case" pendingLabel="Opening case…">
              Open support case
            </SubmitButton>
          </Form>
        </article>

        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Recent cases</span>
              <h2>Account support history.</h2>
            </div>
            <small>{data.email}</small>
          </div>

          {data.cases.length ? (
            <div className="f9-work-list">
              {data.cases.map((supportCase) => (
                <SupportCaseRow
                  isSelected={data.selectedCase?.id === supportCase.id}
                  key={supportCase.id}
                  supportCase={supportCase}
                />
              ))}
            </div>
          ) : (
            <div className="f9-message">
              <p>No support cases yet. Billing, cancellation, setup, deletion, and security requests can start here.</p>
            </div>
          )}

          {data.requestedCaseMissing ? (
            <div className="f9-message is-error">
              <p>That support case is not available for this login.</p>
            </div>
          ) : null}

          {data.selectedCase ? (
            <SupportCaseDetail events={data.caseEvents} supportCase={data.selectedCase} />
          ) : null}

          {data.isWorkspaceMember ? (
            <div className="f9-message">
              <p>
                Your support history is private to your login. Account billing changes may still need
                the owner to confirm.
              </p>
            </div>
          ) : null}

          <div className="f9-work-list is-compact">
            <div className="f9-work-row">
              <strong>Fallback</strong>
              <span>
                Email <a href={SUPPORT_MAILTO}>{data.supportEmail}</a> from {data.email}.
              </span>
            </div>
            <div className="f9-work-row">
              <strong>Billing</strong>
              <span>
                Plan changes and cancellation stay backed by support until the hosted portal setting is confirmed.
              </span>
            </div>
            <div className="f9-work-row">
              <strong>Docs</strong>
              <span>
                <Link to="/help">Help center</Link> and <Link to="/docs">docs</Link> remain public.
              </span>
            </div>
          </div>
        </article>
      </div>
      </section>
    </DashboardPage>
  );
}

interface SupportCaseSummary {
  id: string;
  category: SupportCaseCategory;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  subject: string;
  createdAt: string;
  updatedAt: string;
}

interface SupportCaseDetailSummary extends SupportCaseSummary {
  detail: string;
}

interface SupportCaseEventSummary {
  id: string;
  eventType: SupportCaseEventType;
  message: string;
  createdAt: string;
}

function SupportCaseRow({
  isSelected,
  supportCase,
}: {
  isSelected: boolean;
  supportCase: SupportCaseSummary;
}) {
  return (
    <Link className={`f9-work-row ${isSelected ? "is-active" : ""}`} to={`/app/support?case=${supportCase.id}`}>
      <div>
        <h3>{supportCase.subject}</h3>
        <small>
          {SUPPORT_CASE_CATEGORY_LABELS[supportCase.category]} · {SUPPORT_CASE_PRIORITY_LABELS[supportCase.priority]} ·{" "}
          <LocalTime iso={supportCase.createdAt} />
        </small>
      </div>
      <span>{SUPPORT_CASE_STATUS_LABELS[supportCase.status]}</span>
    </Link>
  );
}

function SupportCaseDetail({
  events,
  supportCase,
}: {
  events: SupportCaseEventSummary[];
  supportCase: SupportCaseDetailSummary;
}) {
  return (
    <section className="f9-work-list is-compact" aria-label="Selected support case">
      <div className="f9-work-row">
        <div>
          <span className="f9-app-kicker">Selected case</span>
          <h3>{supportCase.subject}</h3>
          <small>
            {SUPPORT_CASE_CATEGORY_LABELS[supportCase.category]} · {SUPPORT_CASE_PRIORITY_LABELS[supportCase.priority]} ·{" "}
            opened <LocalTime iso={supportCase.createdAt} />
          </small>
          <p className="f9-muted-copy">{supportCase.detail}</p>
        </div>
        <span>{SUPPORT_CASE_STATUS_LABELS[supportCase.status]}</span>
      </div>

      <div>
        <span className="f9-app-kicker">Case trail</span>
        {events.length ? (
          <div className="f9-work-list is-compact">
            {events.map((event) => (
              <div className="f9-work-row" key={event.id}>
                <div>
                  <h3>{SUPPORT_CASE_EVENT_LABELS[event.eventType]}</h3>
                  <p className="f9-muted-copy">{event.message}</p>
                </div>
                <small><LocalTime iso={event.createdAt} /></small>
              </div>
            ))}
          </div>
        ) : (
          <p className="f9-muted-copy">No customer-visible events recorded yet.</p>
        )}
      </div>
    </section>
  );
}

function requiresWorkspaceOwnerAuthority(input: {
  category: SupportCaseCategory;
  subject: string;
  detail: string;
}) {
  if (OWNER_ONLY_SUPPORT_CATEGORIES.has(input.category)) {
    return true;
  }
  const requestText = `${input.subject} ${input.detail}`;
  if (TEAM_AUTHORITY_TEXT_PATTERNS.some((pattern) => pattern.test(requestText))) {
    return true;
  }

  return BILLING_CHANGE_TEXT_PATTERN.test(requestText) && WORKSPACE_AUTHORITY_TEXT_PATTERN.test(requestText);
}

function toSupportCaseSummary(supportCase: {
  id: string;
  category: SupportCaseCategory;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  subject: string;
  createdAt: string;
  updatedAt: string;
}): SupportCaseSummary {
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

function toSupportCaseDetail(supportCase: {
  id: string;
  category: SupportCaseCategory;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  subject: string;
  detail: string;
  createdAt: string;
  updatedAt: string;
}): SupportCaseDetailSummary {
  return {
    ...toSupportCaseSummary(supportCase),
    detail: supportCase.detail,
  };
}

function toSupportCaseEventSummary(event: {
  id: string;
  eventType: SupportCaseEventType;
  message: string;
  createdAt: string;
}): SupportCaseEventSummary {
  return {
    id: event.id,
    eventType: event.eventType,
    message: event.message,
    createdAt: event.createdAt,
  };
}

function readSelectedCaseId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 120 ? trimmed : null;
}

type SupportOperatorNotificationResult = "sent" | "already_sent" | "failed";

async function notifySupportCaseOperator(
  env: AppEnv,
  input: {
    caseId: string;
    requesterEmail: string;
    input: {
      category: SupportCaseCategory;
      priority: SupportCasePriority;
      subject: string;
      detail: string;
    };
    isWorkspaceMember: boolean;
  },
): Promise<SupportOperatorNotificationResult> {
  const idempotencyKey = `support-case:${input.caseId}`;
  try {
    const { getDeliveryAttemptByIdempotencyKey } = await import("~/lib/data.server");
    const existingAttempt = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
    if (existingAttempt?.status === "sent") {
      return "already_sent";
    }

    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    const notified = await sendOperatorAlertEmail(env, {
      subject: `0509 support case: ${input.input.subject}`,
      lines: [
        `Case: ${input.caseId}`,
        `Requester: ${input.requesterEmail}`,
        `Category: ${SUPPORT_CASE_CATEGORY_LABELS[input.input.category]}`,
        `Priority: ${SUPPORT_CASE_PRIORITY_LABELS[input.input.priority]}`,
        `Team member: ${input.isWorkspaceMember ? "yes" : "no"}`,
        `Subject: ${input.input.subject}`,
        `Details: ${input.input.detail}`,
      ],
      idempotencyKey,
    });
    return notified ? "sent" : "failed";
  } catch (error) {
    console.error("[support] operator alert failed", error);
    return "failed";
  }
}
