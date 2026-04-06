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
  const { getDigest, listDigests } = await import("~/lib/data.server");
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
  const url = new URL(request.url);
  const selectedDigestId = url.searchParams.get("digest") ?? digests[0]?.id ?? null;
  const selectedDigestCandidate = selectedDigestId ? await getDigest(env, selectedDigestId) : null;
  const selectedDigest =
    selectedDigestCandidate?.userId === session.user.id ? selectedDigestCandidate : null;

  return {
    digests,
    selectedDigest,
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
      message: "Weekly digests are not available in the current workspace.",
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
          <p className="section-label">Weekly digests</p>
          <h2>Weekly digests are not available in the current workspace.</h2>
          <p>
            Use search, watchlists, and collections to keep competitor research organized.
          </p>
        </article>
      ) : (
        <div className="workspace-panels">
          <article className="content-card narrow-card">
            <div className="card-header">
              <div>
                <p className="section-label">Digests</p>
                <h2>Weekly summaries</h2>
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
                      {digest.items.length} changes across weekly monitoring
                    </p>
                    <p className="muted-text">
                      {digest.delivery?.status === "sent"
                        ? "Delivered"
                        : digest.delivery?.status === "failed"
                          ? "Delivery failed"
                          : "Pending delivery"}
                    </p>
                  </div>
                </a>
              ))}
              {data.digests.length === 0 ? (
                <p className="muted-text">Weekly digests will appear after your watchlists start generating events.</p>
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
                <p>Once weekly delivery runs, the generated snapshots show up here.</p>
              </div>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
