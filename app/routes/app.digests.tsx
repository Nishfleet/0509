import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { PLAN_LIMITS, getUserPlan } = await import("~/lib/plan.server");
  const { getDigest, listDeliveryAttempts, listDigests } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const plan = await getUserPlan(env, session.user.id);

  if (!PLAN_LIMITS[plan].digests) {
    return {
      digests: [],
      selectedDigest: null,
      canAccessDigests: false,
    };
  }

  const digests = await listDigests(env, session.user.id);
  const recentDeliveryAttempts = await listDeliveryAttempts(env, {
    userId: session.user.id,
    limit: 80,
  });
  const url = new URL(request.url);
  const selectedDigestId = url.searchParams.get("digest") ?? digests[0]?.id ?? null;
  const selectedDigestCandidate = selectedDigestId ? await getDigest(env, selectedDigestId) : null;
  const selectedDigest =
    selectedDigestCandidate?.userId === session.user.id ? selectedDigestCandidate : null;

  return {
    digests,
    digestAttemptsByDigestId: Object.fromEntries(
      digests.map((digest) => [
        digest.id,
        summarizeDigestAttempts(
          recentDeliveryAttempts.filter((attempt) => attempt.digestRunId === digest.id),
        ),
      ]),
    ),
    selectedDigest,
    selectedDigestAttempts: selectedDigest
      ? summarizeDigestAttempts(
          recentDeliveryAttempts.filter((attempt) => attempt.digestRunId === selectedDigest.id),
        )
      : [],
    canAccessDigests: true,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { PLAN_LIMITS, getUserPlan } = await import("~/lib/plan.server");
  const { createShareLink, getDigest } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const plan = await getUserPlan(env, session.user.id);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (!PLAN_LIMITS[plan].digests) {
    return {
      ok: false,
      error: "plan_limit_exceeded",
      message: "Proof-backed digests are not available in the current workspace.",
    };
  }

  if (intent === "share-digest") {
    const digestId = String(formData.get("digestId") ?? "");
    const digest = await getDigest(env, digestId);

    if (!digest || digest.userId !== session.user.id) {
      return {
        ok: false,
        message: "Digest not found.",
      };
    }

    const share = await createShareLink(env, session, {
      resourceType: "digest",
      resourceId: digest.id,
      isSnapshot: true,
      snapshotPayload: digest as unknown as Record<string, unknown>,
    });

    return {
      ok: true,
      message: `${new URL(`/share/${share.token}`, request.url).toString()}`,
    };
  }

  return {
    ok: false,
    message: "Unknown digest action.",
  };
}

export default function DigestsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const digestAttemptsByDigestId: Record<
    string,
    Array<{
      channel: string;
      targetValue: string;
      status: string;
      errorMessage: string | null;
      createdAt: string;
    }>
  > = data.canAccessDigests ? (data.digestAttemptsByDigestId ?? {}) : {};
  const selectedDigestAttempts: Array<{
    channel: string;
    targetValue: string;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  }> = data.canAccessDigests ? (data.selectedDigestAttempts ?? []) : [];

  return (
    <section className="workspace-section-stack">
      {actionData?.message ? (
        <div className={`form-message ${actionData.ok ? "form-message-success" : "form-message-error"}`}>
          <p>
            {actionData.ok && actionData.message.startsWith("http") ? (
              <a href={actionData.message} rel="noreferrer" target="_blank">
                {actionData.message}
              </a>
          ) : (
              actionData.message
            )}
          </p>
        </div>
      ) : null}

      {!data.canAccessDigests ? (
        <article className="content-card empty-state">
          <p className="section-label">Digest history</p>
          <h2>Proof-backed digests are not available in the current workspace.</h2>
          <p>
            Use watchlists and collections to keep competitor monitoring organized until digests are unlocked.
          </p>
        </article>
      ) : (
        <div className="workspace-panels">
          <article className="content-card narrow-card">
            <div className="card-header">
              <div>
                <p className="section-label">Digests</p>
                <h2>Digest history</h2>
              </div>
            </div>

            <div className="stack-list compact-list">
              {data.digests.map((digest) => (
                <a
                  className={`list-card ${searchParams.get("digest") === digest.id || (!searchParams.get("digest") && data.selectedDigest?.id === digest.id) ? "is-active" : ""}`}
                  href={`/app/digests?digest=${digest.id}`}
                  key={digest.id}
                >
                  <div>
                    <h3>{new Date(digest.periodEnd).toLocaleDateString("en-IN")}</h3>
                    <p className="muted-text">
                      {digest.items.length} proof-backed changes ready for review
                    </p>
                    <p className="muted-text">
                      {formatDigestSidebarStatus(
                        digestAttemptsByDigestId[digest.id] ?? [],
                        digest.delivery?.status ?? null,
                      )}
                    </p>
                  </div>
                </a>
              ))}
              {data.digests.length === 0 ? (
                <p className="muted-text">Digest history will appear after your watchlists start generating confirmed events.</p>
              ) : null}
            </div>
          </article>

          <article className="content-card">
            {data.selectedDigest ? (
              <>
                <div className="card-header">
                  <div>
                    <p className="section-label">Selected digest</p>
                    <h2>
                      {new Date(data.selectedDigest.periodStart).toLocaleDateString("en-IN")} to{" "}
                      {new Date(data.selectedDigest.periodEnd).toLocaleDateString("en-IN")}
                    </h2>
                  </div>
                  <div className="inline-actions">
                    <a
                      className="button button-secondary"
                      href={`/export/digest/${data.selectedDigest.id}`}
                    >
                      Export CSV
                    </a>
                    <Form method="post">
                      <input name="intent" type="hidden" value="share-digest" />
                      <input name="digestId" type="hidden" value={data.selectedDigest.id} />
                      <button className="button button-primary" type="submit">
                        Share snapshot
                      </button>
                    </Form>
                  </div>
                </div>

                <section className="stack-list compact-list" style={{ marginBottom: "1rem" }}>
                  <div>
                    <p className="section-label">Delivery status</p>
                    <h3 style={{ marginTop: 0 }}>Recent channel outcomes</h3>
                  </div>
                  {selectedDigestAttempts.length > 0 ? (
                    selectedDigestAttempts.map((attempt) => (
                      <div className="list-card" key={`${attempt.channel}:${attempt.targetValue}`}>
                        <div>
                          <h4 style={{ marginBottom: "0.25rem" }}>
                            {attempt.channel === "email" ? "Email" : "WhatsApp"}
                          </h4>
                          <p className="muted-text" style={{ marginBottom: "0.25rem" }}>
                            {describeAttemptStatus(attempt.status)}
                          </p>
                          <p className="muted-text">{attempt.targetValue}</p>
                          {attempt.errorMessage ? (
                            <p className="muted-text">{attempt.errorMessage}</p>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="muted-text">
                      {data.selectedDigest.delivery?.status === "sent"
                        ? "Legacy email delivery recorded."
                        : "No channel-level delivery attempts recorded yet."}
                    </p>
                  )}
                </section>

                <ul className="event-list">
                  {data.selectedDigest.items.map((item) => (
                    <li className="event-card" key={item.id}>
                      <div className="card-header">
                        <div>
                          <p className="section-label">{item.watchlistName}</p>
                          <h3>{item.title}</h3>
                        </div>
                        <span className="badge">{item.eventType.replaceAll("_", " ")}</span>
                      </div>
                      <p>{item.summary}</p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="empty-state">
                <h2>No digest selected</h2>
                <p>Once proof-backed delivery runs, the generated snapshots show up here.</p>
              </div>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

function summarizeDigestAttempts(
  attempts: Array<{
    channel: string;
    targetValue: string;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  }>,
) {
  const latestByChannelTarget = new Map<string, (typeof attempts)[number]>();

  for (const attempt of attempts) {
    const key = `${attempt.channel}:${attempt.targetValue}`;
    if (!latestByChannelTarget.has(key)) {
      latestByChannelTarget.set(key, attempt);
    }
  }

  return [...latestByChannelTarget.values()];
}

function formatDigestSidebarStatus(
  attempts: Array<{ channel: string; status: string }>,
  legacyStatus: string | null,
) {
  if (attempts.length === 0) {
    if (legacyStatus === "sent") {
      return "Delivered";
    }
    if (legacyStatus === "failed") {
      return "Delivery failed";
    }
    return "Waiting for delivery activity";
  }

  return attempts
    .map((attempt) => `${attempt.channel === "email" ? "Email" : "WhatsApp"} ${describeAttemptStatus(attempt.status).toLowerCase()}`)
    .join(" · ");
}

function describeAttemptStatus(status: string) {
  switch (status) {
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    case "skipped_due_to_quiet_hours":
      return "Deferred by quiet hours";
    case "skipped_due_to_dedupe":
      return "Skipped as duplicate";
    default:
      return "Pending";
  }
}
