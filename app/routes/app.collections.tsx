import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { AdLongevityPill } from "~/components/ad-longevity-pill";
import { AdThumb } from "~/components/ad-thumb";
import { InsightDepthPanel } from "~/components/insight-depth-panel";
import { CopyButton } from "~/components/copy-button";
import { SubmitButton } from "~/components/submit-button";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import { buildCollectionInsightDepth } from "~/lib/insight-depth";
import { proofLinkForAd } from "~/lib/proof-link";
import { createReportId } from "~/lib/report";

const externalProofChannels = [
  "TikTok",
  "Google / YouTube",
  "LinkedIn",
  "Pinterest",
  "Meta",
  "Landing page",
  "Other",
];

export const meta = () => [{ title: "Boards | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getCollection, listCollectionItems, listCollections } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const collections = await listCollections(env, session.user.id);
  const url = new URL(request.url);
  const selectedCollectionId = url.searchParams.get("collection") ?? collections[0]?.id ?? null;
  const selectedCollection = selectedCollectionId
    ? await getCollection(env, selectedCollectionId, session.user.id)
    : null;
  const items = selectedCollection ? await listCollectionItems(env, selectedCollection.id) : [];

  return {
    collections,
    selectedCollection,
    items,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const {
    addExternalProofToCollection,
    createCollection,
    createShareLink,
    getCollection,
    updateCollectionItem,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "create-collection") {
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    if (!name) {
      return { ok: false, message: "Board name is required." };
    }

    const collectionLimit = await checkPlanLimit(env, session.user.id, "collections");
    if (!collectionLimit.allowed) {
      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: collectionLimit.limit,
        current: collectionLimit.current,
        message: "You have reached your workspace board limit.",
      };
    }

    const collection = await createCollection(env, session.user.id, {
      name,
      description,
    });

    return {
      ok: true,
      message: `Created ${collection?.name ?? name}.`,
    };
  }

  if (intent === "update-item") {
    const itemId = String(formData.get("itemId") ?? "");
    const note = String(formData.get("note") ?? "").trim();
    const tags = String(formData.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    await updateCollectionItem(env, session.user.id, itemId, {
      note: note || null,
      tags,
    });

    return {
      ok: true,
      message: "Board note updated.",
    };
  }

  if (intent === "add-external-proof") {
    const collectionId = String(formData.get("collectionId") ?? "");
    const advertiser = String(formData.get("advertiser") ?? "");
    const proofUrl = String(formData.get("proofUrl") ?? "");
    const channel = String(formData.get("channel") ?? "");
    const hook = String(formData.get("hook") ?? "");
    const offer = String(formData.get("offer") ?? "");
    const cta = String(formData.get("cta") ?? "");
    const note = String(formData.get("note") ?? "");
    const observedAt = String(formData.get("observedAt") ?? "");
    const spend = String(formData.get("spend") ?? "");
    const impressions = String(formData.get("impressions") ?? "");
    const reach = String(formData.get("reach") ?? "");
    const tags = String(formData.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const ad = await addExternalProofToCollection(env, session.user.id, collectionId, {
      advertiser,
      proofUrl,
      channel,
      hook,
      offer,
      cta,
      note,
      observedAt,
      spend,
      impressions,
      reach,
      tags,
    });

    return {
      ok: true,
      message: `Saved ${ad.platforms[0] ?? "external"} proof for ${ad.advertiser}.`,
    };
  }

  if (intent === "delete-collection") {
    const { deleteCollection } = await import("~/lib/data.server");
    const collectionId = String(formData.get("collectionId") ?? "");
    const deleted = await deleteCollection(env, session.user.id, collectionId);

    return deleted
      ? { ok: true, message: "Board deleted. The plan slot is free again." }
      : { ok: false, message: "Board not found." };
  }

  if (intent === "remove-item") {
    const { deleteCollectionItem } = await import("~/lib/data.server");
    const itemId = String(formData.get("itemId") ?? "");
    const removed = await deleteCollectionItem(env, session.user.id, itemId);

    return removed
      ? { ok: true, message: "Removed from the board." }
      : { ok: false, message: "Board item not found." };
  }

  if (intent === "share-collection") {
    const collectionId = String(formData.get("collectionId") ?? "");
    const collection = await getCollection(env, collectionId, session.user.id);
    if (!collection) {
      return { ok: false, message: "Board not found." };
    }
    const share = await createShareLink(env, session, {
      resourceType: "collection",
      resourceId: collection.id,
      isSnapshot: false,
    });

    return {
      ok: true,
      message: `${new URL(`/share/${share.token}`, request.url).toString()}`,
    };
  }

  return {
    ok: false,
    message: "Unknown boards action.",
  };
}

export default function CollectionsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const insightDepth = data.selectedCollection ? buildCollectionInsightDepth(data.items) : null;

  return (
    <section className="f9-app-stack">
      {actionData?.message ? (
        <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
          <p>
            {actionData.ok && actionData.message.startsWith("http") ? (
              <>
                <a href={actionData.message} rel="noreferrer" target="_blank">
                  {actionData.message}
                </a>{" "}
                <CopyButton value={actionData.message} />
              </>
              ) : (
                actionData.message
              )}
            {"error" in actionData && actionData.error === "plan_limit_exceeded" ? (
              <>
                {" "}
                <Link to="/#pricing">View plans</Link> to raise the limit.
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel f9-side-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Create board</span>
              <h2>Keep the best ads reusable.</h2>
            </div>
          </div>

          <Form className="f9-auth-form" method="post">
            <input name="intent" type="hidden" value="create-collection" />
            <label className="f9-field">
              <span>Name</span>
              <input name="name" placeholder="Nykaa competitors" required />
            </label>
            <label className="f9-field">
              <span>Description</span>
              <textarea name="description" placeholder="Optional context for the team" rows={3} />
            </label>
            <SubmitButton className="f9-primary-button" intent="create-collection" pendingLabel="Creating…">
              Create board
            </SubmitButton>
          </Form>

          <div className="f9-work-list is-compact">
            {data.collections.map((collection) => (
              <Link
                className={`f9-work-row ${searchParams.get("collection") === collection.id || (!searchParams.get("collection") && data.selectedCollection?.id === collection.id) ? "is-active" : ""}`}
                key={collection.id}
                to={`/app/collections?collection=${collection.id}`}
              >
                <div>
                  <h3>{collection.name}</h3>
                  <p className="f9-muted-copy">{collection.description || "No description yet."}</p>
                </div>
              </Link>
            ))}
            {data.collections.length === 0 ? (
              <div className="f9-empty-panel">
                <h3>Create your first proof board</h3>
                <p>Group competitor ads, offers, and landing-page proof for the deal or client you are working on.</p>
              </div>
            ) : null}
          </div>
        </article>

        <article className="f9-app-panel">
          {data.selectedCollection ? (
            <>
              <div className="f9-panel-toolbar">
                <div>
                  <span className="f9-app-kicker">Selected board</span>
                  <h2>{data.selectedCollection.name}</h2>
                </div>
                <div className="f9-action-row">
                  <Link
                    className="f9-secondary-button"
                    to={`/app/reports/${createReportId("collection", data.selectedCollection.id)}`}
                  >
                    Open report
                  </Link>
                  <a
                    className="f9-secondary-button"
                    href={`/export/collection/${data.selectedCollection.id}`}
                  >
                    Export CSV
                  </a>
                  <a
                    className="f9-secondary-button"
                    href={`/export/collection/${data.selectedCollection.id}?format=json`}
                  >
                    API JSON
                  </a>
                  <a
                    className="f9-secondary-button"
                    href={`/export/collection/${data.selectedCollection.id}?format=slack`}
                  >
                    Slack copy
                  </a>
                  <Form method="post">
                    <input name="intent" type="hidden" value="share-collection" />
                    <input name="collectionId" type="hidden" value={data.selectedCollection.id} />
                    <SubmitButton className="f9-primary-button" intent="share-collection" pendingLabel="Creating…">
                      Create share link
                    </SubmitButton>
                  </Form>
                  <Form
                    method="post"
                    onSubmit={(event) => {
                      if (!confirm("Delete this board and everything saved in it?")) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input name="intent" type="hidden" value="delete-collection" />
                    <input name="collectionId" type="hidden" value={data.selectedCollection.id} />
                    <SubmitButton className="f9-secondary-button" intent="delete-collection" pendingLabel="Deleting…">
                      Delete board
                    </SubmitButton>
                  </Form>
                </div>
              </div>

              {insightDepth ? <InsightDepthPanel summary={insightDepth} /> : null}

              <Form className="f9-auth-form" method="post">
                <input name="intent" type="hidden" value="add-external-proof" />
                <input name="collectionId" type="hidden" value={data.selectedCollection.id} />
                <div className="f9-panel-toolbar">
                  <div>
                    <span className="f9-app-kicker">External proof</span>
                    <h3>Add a proof link</h3>
                  </div>
                </div>
                <div className="f9-field-grid">
                  <label className="f9-field">
                    <span>Channel</span>
                    <select name="channel" defaultValue="TikTok">
                      {externalProofChannels.map((channel) => (
                        <option key={channel} value={channel}>
                          {channel}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="f9-field">
                    <span>Advertiser</span>
                    <input name="advertiser" placeholder="Competitor name" required />
                  </label>
                </div>
                <label className="f9-field">
                  <span>Proof URL</span>
                  <input name="proofUrl" placeholder="https://..." required type="url" />
                </label>
                <label className="f9-field">
                  <span>Hook</span>
                  <input name="hook" placeholder="Main claim, hook, or visible change" required />
                </label>
                <div className="f9-field-grid">
                  <label className="f9-field">
                    <span>Offer</span>
                    <input name="offer" placeholder="Optional offer" />
                  </label>
                  <label className="f9-field">
                    <span>CTA</span>
                    <input name="cta" placeholder="Optional CTA" />
                  </label>
                </div>
                <div className="f9-field-grid">
                  <label className="f9-field">
                    <span>Observed</span>
                    <input name="observedAt" type="date" />
                  </label>
                  <label className="f9-field">
                    <span>Tags</span>
                    <input name="tags" placeholder="campaign, launch, offer" />
                  </label>
                </div>
                <div className="f9-field-grid">
                  <label className="f9-field">
                    <span>Spend</span>
                    <input name="spend" placeholder="Visible spend" />
                  </label>
                  <label className="f9-field">
                    <span>Impressions</span>
                    <input name="impressions" placeholder="Visible impressions" />
                  </label>
                </div>
                <label className="f9-field">
                  <span>Reach</span>
                  <input name="reach" placeholder="Visible reach" />
                </label>
                <label className="f9-field">
                  <span>Note</span>
                  <textarea name="note" placeholder="Optional team context" rows={2} />
                </label>
                <SubmitButton className="f9-secondary-button" intent="add-external-proof" pendingLabel="Saving…">
                  Save proof link
                </SubmitButton>
              </Form>

              {data.items.length === 0 ? (
                <div className="f9-empty-panel">
                  <h2>Add proof or save from search</h2>
                  <p>Save a proof link here, or run a competitor search and save the examples your team needs to reuse.</p>
                  <Link className="f9-primary-button" to="/search">
                    Open search
                  </Link>
                </div>
              ) : (
                <div className="f9-work-list">
                  {data.items.map((item) => (
                    <article className="f9-work-row" key={item.id}>
                      <div className="f9-panel-toolbar">
                        <div className="f9-ad-thumb-row">
                          <AdThumb ad={item.ad} />
                          <div>
                            <h3>{formatAdvertiserLabel(item.ad.advertiser)}</h3>
                            <AdLongevityPill ad={item.ad} />
                            <p className="f9-muted-copy">{item.ad.hook}</p>
                          </div>
                        </div>
                        <span className="f9-status-pill">{item.ad.platforms?.[0] ?? item.ad.format}</span>
                      </div>
                      <p>{item.ad.offer}</p>
                      {proofLinkForAd(item.ad) ? (
                        <p className="f9-muted-copy">
                          <a href={proofLinkForAd(item.ad) ?? undefined} rel="noreferrer" target="_blank">
                            Open proof
                          </a>
                        </p>
                      ) : null}
                      <p className="f9-muted-copy">
                        {item.tags.length > 0 ? item.tags.join(", ") : "No tags yet"}
                      </p>
                      <Form className="f9-auth-form" method="post">
                        <input name="intent" type="hidden" value="update-item" />
                        <input name="itemId" type="hidden" value={item.id} />
                        <label className="f9-field">
                          <span>Note</span>
                          <textarea defaultValue={item.note ?? ""} name="note" rows={3} />
                        </label>
                        <label className="f9-field">
                          <span>Tags</span>
                          <input defaultValue={item.tags.join(", ")} name="tags" />
                        </label>
                        <SubmitButton
                          className="f9-secondary-button"
                          intent="update-item"
                          match={{ itemId: item.id }}
                          pendingLabel="Updating…"
                        >
                          Update item
                        </SubmitButton>
                      </Form>
                      <Form method="post">
                        <input name="intent" type="hidden" value="remove-item" />
                        <input name="itemId" type="hidden" value={item.id} />
                        <SubmitButton
                          className="f9-secondary-button"
                          intent="remove-item"
                          match={{ itemId: item.id }}
                          pendingLabel="Removing…"
                        >
                          Remove from board
                        </SubmitButton>
                      </Form>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="f9-empty-panel">
              <h2>Create your first proof board</h2>
              <p>Boards keep competitor examples, notes, tags, and share links ready for your team.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
