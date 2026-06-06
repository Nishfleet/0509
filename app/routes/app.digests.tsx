import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DigestIntelligence, DigestMovementSummary } from "~/components/digest-intelligence";

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
    <section className="f9-app-stack">
      {actionData?.message ? (
        <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
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
        <article className="f9-app-panel f9-empty-panel">
          <span className="f9-app-kicker">Digest history</span>
          <h2>Proof-backed digests are not available in the current workspace.</h2>
          <p>
            Use watchlists and collections to keep competitor monitoring organized until digests are unlocked.
          </p>
        </article>
      ) : (
        <div className="f9-dashboard-grid">
          <article className="f9-app-panel f9-side-panel">
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-app-kicker">Digests</span>
                <h2>Digest history</h2>
              </div>
            </div>

            <div className="f9-work-list is-compact">
              {data.digests.map((digest) => (
                <a
                  className={`f9-work-row ${searchParams.get("digest") === digest.id || (!searchParams.get("digest") && data.selectedDigest?.id === digest.id) ? "is-active" : ""}`}
                  href={`/app/digests?digest=${digest.id}`}
                  key={digest.id}
                >
                  <div>
                    <h3>{new Date(digest.periodEnd).toLocaleDateString("en-IN")}</h3>
                    <p className="f9-muted-copy">
                      {digest.items.length} proof-backed changes ready for review
                    </p>
                    <p className="f9-muted-copy">
                      {formatDigestSidebarStatus(
                        digestAttemptsByDigestId[digest.id] ?? [],
                        digest.delivery?.status ?? null,
                      )}
                    </p>
                  </div>
                </a>
              ))}
              {data.digests.length === 0 ? (
                <div className="f9-empty-panel">
                  <h3>Your first brief appears after a confirmed change</h3>
                  <p>Start a competitor watchlist and proof-backed changes will roll into digest history.</p>
                </div>
              ) : null}
            </div>
          </article>

          <article className="f9-app-panel">
            {data.selectedDigest ? (
              <>
                <div className="f9-panel-toolbar">
                  <div>
                    <span className="f9-app-kicker">Selected digest</span>
                    <h2>
                      {new Date(data.selectedDigest.periodStart).toLocaleDateString("en-IN")} to{" "}
                      {new Date(data.selectedDigest.periodEnd).toLocaleDateString("en-IN")}
                    </h2>
                  </div>
                  <div className="f9-action-row">
                    <a
                      className="f9-secondary-button"
                      href={`/export/digest/${data.selectedDigest.id}`}
                    >
                      Export CSV
                    </a>
                    <Form method="post">
                      <input name="intent" type="hidden" value="share-digest" />
                      <input name="digestId" type="hidden" value={data.selectedDigest.id} />
                      <button className="f9-primary-button" type="submit">
                        Share snapshot
                      </button>
                    </Form>
                  </div>
                </div>

                <section className="f9-work-list is-compact" style={{ marginBottom: "1rem" }}>
                  <div>
                    <span className="f9-app-kicker">Delivery status</span>
                    <h3 style={{ marginTop: 0 }}>Recent channel outcomes</h3>
                  </div>
                  {selectedDigestAttempts.length > 0 ? (
                    selectedDigestAttempts.map((attempt) => (
                      <div className="f9-work-row" key={`${attempt.channel}:${attempt.targetValue}`}>
                        <div>
                          <h4 style={{ marginBottom: "0.25rem" }}>
                            {attempt.channel === "email" ? "Email" : "WhatsApp"}
                          </h4>
                          <p className="f9-muted-copy" style={{ marginBottom: "0.25rem" }}>
                            {describeAttemptStatus(attempt.status)}
                          </p>
                          <p className="f9-muted-copy">{attempt.targetValue}</p>
                          {attempt.errorMessage ? (
                            <p className="f9-muted-copy">{attempt.errorMessage}</p>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="f9-muted-copy">
                      {data.selectedDigest.delivery?.status === "sent"
                        ? "Legacy email delivery recorded."
                        : "No channel-level delivery attempts recorded yet."}
                    </p>
                  )}
                </section>

                <DigestMovementSummary items={data.selectedDigest.items} />

                <ul className="event-list">
                  {data.selectedDigest.items.map((item) => (
                    <li className="f9-event-card" key={item.id}>
                      <div className="f9-panel-toolbar">
                        <div>
                          <span className="f9-app-kicker">{item.watchlistName}</span>
                          <h3>{item.title}</h3>
                        </div>
                        <span className="f9-status-pill">{item.eventType.replaceAll("_", " ")}</span>
                      </div>
                      <p>{item.summary}</p>
                      <DigestIntelligence metadata={item.metadata} />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="f9-empty-panel">
                <h2>Your first brief appears after a confirmed change</h2>
                <p>Once a watchlist finds proof-backed movement, the generated snapshot shows up here.</p>
                <Link className="f9-primary-button" to="/app/watchlists">
                  Open watchlists
                </Link>
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
