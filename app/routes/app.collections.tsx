import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { AdLongevityPill } from "~/components/ad-longevity-pill";
import { Pill } from "~/components/pill";
import { AdThumb } from "~/components/ad-thumb";
import { InsightDepthPanel } from "~/components/insight-depth-panel";
import { ActionFeedback } from "~/components/action-feedback";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { CopyButton } from "~/components/copy-button";
import { EmptyState } from "~/components/empty-state";
import { PlanLimitState } from "~/components/plan-limit-state";
import { SubmitButton } from "~/components/submit-button";
import { formatAdvertiserLabel, formatMachineTokenLabel } from "~/lib/landing-page-display";
import { matchesAdvertiserFilter } from "~/lib/watchlist-links";
import { buildCollectionInsightDepth } from "~/lib/insight-depth";
import { canUsePlanFeature, getPlanLimit } from "~/lib/plan-entitlements";
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

export const meta = () => [{ title: "Collections | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Collections" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getCollection, listCollectionItems, listCollections } = await import("~/lib/data.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const url = new URL(request.url);
  const requestedCollectionId = url.searchParams.get("collection");
  // Cross-link filter (workflow-friction pass): watchlists deep-link here
  // with ?advertiser= to show only that competitor's saved ads.
  const advertiserFilter = url.searchParams.get("advertiser")?.trim() || null;
  // Deep links (`?collection=<id>`) resolve the selected collection and its
  // items concurrently with the list; the default view chains off the same
  // in-flight list promise to pick the first collection. Items are fetched
  // alongside the ownership-scoped getCollection and discarded unless that
  // check passes, trading one speculative read for one less serial wave.
  const collectionsPromise = listCollections(env, workspaceUserId);
  const selectionPromise = (async () => {
    const id = requestedCollectionId ?? (await collectionsPromise)[0]?.id ?? null;
    if (!id) {
      return { collection: null, items: [] as Awaited<ReturnType<typeof listCollectionItems>> };
    }
    const [collection, items] = await Promise.all([
      getCollection(env, id, workspaceUserId),
      listCollectionItems(env, id),
    ]);
    return { collection, items: collection ? items : [] };
  })();
  const [collections, plan, { collection: selectedCollection, items: allItems }] = await Promise.all([
    collectionsPromise,
    getUserPlan(env, workspaceUserId),
    selectionPromise,
  ]);
  // The advertiser filter applies after the concurrent waves resolve — it
  // never serializes the loader.
  const items = advertiserFilter
    ? allItems.filter((item) => matchesAdvertiserFilter(item.ad.advertiser, advertiserFilter))
    : allItems;

  return {
    collections,
    plan,
    selectedCollection,
    items,
    advertiserFilter,
    hiddenByAdvertiserFilter: allItems.length - items.length,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { requireWorkspacePlanLimit } = await import("~/lib/with-workspace.server");
  const {
    addExternalProofToCollection,
    createCollectionWithinLimit,
    createShareLink,
    getCollection,
    updateCollectionItem,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "create-collection") {
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    if (!name) {
      return { ok: false, intent, message: "Give the collection a name first." };
    }

    const limitGate = await requireWorkspacePlanLimit(env, workspaceUserId, "collections", {
      limitMessage: "You've reached your collection limit.",
    });
    if (!limitGate.ok) {
      return { ...limitGate.result, intent };
    }

    const collectionResult = await createCollectionWithinLimit(env, workspaceUserId, {
      name,
      description,
    }, limitGate.planLimit.limit);

    if (collectionResult.status === "over_cap") {
      return {
        ok: false,
        intent,
        error: "plan_limit_exceeded" as const,
        limit: collectionResult.limit,
        current: collectionResult.current,
        message: "You've reached your collection limit.",
      };
    }

    return {
      ok: true,
      intent,
      message: `Created ${collectionResult.collection.name}.`,
    };
  }

  if (intent === "update-item") {
    const itemId = String(formData.get("itemId") ?? "");
    const note = String(formData.get("note") ?? "").trim();
    const tags = String(formData.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    await updateCollectionItem(env, workspaceUserId, itemId, {
      note: note || null,
      tags,
    });

    return {
      ok: true,
      intent,
      itemId,
      message: "Collection note updated.",
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

    // Invalid URLs or dates throw 4xx Responses out of buildExternalProofAd;
    // return them as inline form feedback instead of nuking the page into
    // the route ErrorBoundary (same pattern as app.notifications.ts).
    let ad;
    try {
      ad = await addExternalProofToCollection(env, workspaceUserId, collectionId, {
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
    } catch (error) {
      if (error instanceof Response && error.status >= 400 && error.status < 500) {
        const { sanitizeCustomerFacingMessage } = await import("~/lib/customer-route-error");
        return {
          ok: false,
          intent,
          message: sanitizeCustomerFacingMessage(
            (await error.text()) || "We couldn't save that evidence link. Check the URL and date, then try again.",
          ),
        };
      }

      throw error;
    }

    return {
      ok: true,
      intent,
      message: `Saved ${ad.platforms[0] ?? "external"} evidence for ${ad.advertiser}.`,
    };
  }

  if (intent === "delete-collection") {
    const { deleteCollection } = await import("~/lib/data.server");
    const collectionId = String(formData.get("collectionId") ?? "");
    const deleted = await deleteCollection(env, workspaceUserId, collectionId);

    return deleted
      ? { ok: true, intent, message: "Collection deleted. The plan slot is free again." }
      : { ok: false, intent, message: "Collection not found." };
  }

  if (intent === "remove-item") {
    const { deleteCollectionItem } = await import("~/lib/data.server");
    const itemId = String(formData.get("itemId") ?? "");
    const removed = await deleteCollectionItem(env, workspaceUserId, itemId);

    return removed
      ? { ok: true, intent, itemId, message: "Removed from the collection." }
      : { ok: false, intent, itemId, message: "Collection item not found." };
  }

  if (intent === "share-collection") {
    const { planFeatureDeniedActionResult, requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
    const shareGate = await requireWorkspacePlanFeature(env, workspaceUserId, "share_links");
    if (!shareGate.ok) {
      return {
        ...planFeatureDeniedActionResult("share_links", shareGate.plan),
        intent,
        message: "Share links are included on Starter and Agency plans.",
        upgradePath: "/app/billing?source=collections#plans",
      };
    }
    const collectionId = String(formData.get("collectionId") ?? "");
    const collection = await getCollection(env, collectionId, workspaceUserId);
    if (!collection) {
      return { ok: false, intent, message: "Collection not found." };
    }
    const share = await createShareLink(
      env,
      { ...session, user: { ...session.user, id: workspaceUserId } },
      {
      resourceType: "collection",
      resourceId: collection.id,
      isSnapshot: false,
    });

    return {
      ok: true,
      intent,
      message: "Share link created.",
      shareUrl: new URL(`/share/${share.token}`, request.url).toString(),
    };
  }

  return {
    ok: false,
    message: "Unknown collections action.",
  };
}

export default function CollectionsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const plan = data.plan ?? "free";
  const collectionLimit = getPlanLimit(plan, "collections");
  const canCreateCollection = data.collections.length < collectionLimit;
  const insightDepth = data.selectedCollection ? buildCollectionInsightDepth(data.items) : null;
  const canOpenReport = canUsePlanFeature(plan, "client_reports");
  const canExport =
    canUsePlanFeature(plan, "export_csv") && canUsePlanFeature(plan, "export_json");
  const canShare = canUsePlanFeature(plan, "share_links");
  const shareUrl =
    actionData && "shareUrl" in actionData && typeof actionData.shareUrl === "string"
      ? actionData.shareUrl
      : null;

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          lead="Save the best competitor examples, external evidence, and notes for your team."
          title="Collections"
        />

      <ActionFeedback
        data={actionData}
        fallback
        planLimitTo="/app/billing?source=collections#plans"
      />
      <ActionFeedback data={actionData} intent="delete-collection" />

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel f9-side-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Create collection</span>
              <h2>Keep the best ads reusable.</h2>
            </div>
          </div>

          <ActionFeedback
            data={actionData}
            intent="create-collection"
            planLimitTo="/app/billing?source=collections#plans"
          />
          {canCreateCollection ? (
            <Form className="f9-auth-form" method="post">
              <input name="intent" type="hidden" value="create-collection" />
              <label className="f9-field">
                <span>Name</span>
                <input name="name" placeholder="Competitor set A" required />
              </label>
              <label className="f9-field">
                <span>Description</span>
                <textarea name="description" placeholder="Optional context for the team" rows={3} />
              </label>
              <SubmitButton className="f9-primary-button" intent="create-collection" pendingLabel="Creating…">
                Create collection
              </SubmitButton>
            </Form>
          ) : (
            <PlanLimitState
              current={collectionLimit > 0 ? data.collections.length : undefined}
              limit={collectionLimit > 0 ? collectionLimit : undefined}
              message={
                collectionLimit === 0
                  ? "Collections start on the Scout plan. Upgrade to save reusable competitor evidence."
                  : "You've reached your collection limit. Upgrade to save another collection."
              }
              title={collectionLimit === 0 ? "Collections are not included on this plan" : "Collection limit reached"}
            />
          )}

          <div className="f9-work-list is-compact">
            {data.collections.map((collection) => (
              <Link
                className={`f9-work-row ${searchParams.get("collection") === collection.id || (!searchParams.get("collection") && data.selectedCollection?.id === collection.id) ? "is-active" : ""}`}
                key={collection.id}
                to={`/app/collections?collection=${collection.id}${
                  data.advertiserFilter ? `&advertiser=${encodeURIComponent(data.advertiserFilter)}` : ""
                }`}
              >
                <div>
                  <h3>{collection.name}</h3>
                  <p className="f9-muted-copy">{collection.description || "No description yet."}</p>
                </div>
              </Link>
            ))}
            {data.collections.length === 0 ? (
              <EmptyState
                description="Saved competitor sets appear here."
                title="Nothing saved yet"
                variant="inline"
              />
            ) : null}
          </div>
        </article>

        <article className="f9-app-panel">
          {data.selectedCollection ? (
            <>
              <div className="f9-panel-toolbar">
                <div>
                  <span className="f9-app-kicker">Selected collection</span>
                  <h2>{data.selectedCollection.name}</h2>
                </div>
                <div className="f9-action-row">
                  {canOpenReport ? (
                    <Link
                      className="f9-secondary-button"
                      to={`/app/reports/${createReportId("collection", data.selectedCollection.id)}`}
                    >
                      Open report
                    </Link>
                  ) : (
                    <div>
                      <button
                        aria-disabled="true"
                        className="f9-secondary-button"
                        disabled
                        type="button"
                      >
                        Open report (Agency only)
                      </button>{" "}
                      <Link className="f9-text-link" to="/app/billing?source=collections#plans">
                        Upgrade to Agency
                      </Link>
                    </div>
                  )}
                  {canExport ? (
                    <>
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
                        Export JSON
                      </a>
                    </>
                  ) : (
                    <Link className="f9-secondary-button" to="/app/billing?source=collections#plans">
                      Upgrade to Starter for exports
                    </Link>
                  )}
                  {canShare ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="share-collection" />
                      <input name="collectionId" type="hidden" value={data.selectedCollection.id} />
                      <SubmitButton className="f9-primary-button" intent="share-collection" pendingLabel="Creating…">
                        Create share link
                      </SubmitButton>
                    </Form>
                  ) : (
                    <Link className="f9-primary-button" to="/app/billing?source=collections#plans">
                      Upgrade to Agency to share
                    </Link>
                  )}
                  <Form method="post">
                    <input name="intent" type="hidden" value="delete-collection" />
                    <input name="collectionId" type="hidden" value={data.selectedCollection.id} />
                    <ConfirmSubmitButton
                      className="f9-secondary-button"
                      confirmLabel="Confirm — delete collection?"
                      intent="delete-collection"
                      pendingLabel="Deleting…"
                    >
                      Delete collection
                    </ConfirmSubmitButton>
                  </Form>
                </div>
              </div>

              <ActionFeedback data={actionData} intent="share-collection">
                {shareUrl ? (
                  <>
                    {" "}
                    <a href={shareUrl} rel="noreferrer" target="_blank">
                      {shareUrl}
                    </a>{" "}
                    <CopyButton value={shareUrl} />
                  </>
                ) : null}
                {actionData?.intent === "share-collection" &&
                "error" in actionData &&
                actionData.error === "plan_gated" ? (
                  <>
                    {" "}
                    <Link to="/app/billing?source=collections#plans">Upgrade to Agency</Link>
                  </>
                ) : null}
              </ActionFeedback>

              {insightDepth ? <InsightDepthPanel summary={insightDepth} /> : null}

              <Form className="f9-auth-form" method="post">
                <input name="intent" type="hidden" value="add-external-proof" />
                <input name="collectionId" type="hidden" value={data.selectedCollection.id} />
                <div className="f9-panel-toolbar">
                  <div>
                    <span className="f9-app-kicker">External evidence</span>
                    <h3>Add an evidence link</h3>
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
                  <span>Evidence URL</span>
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
                <ActionFeedback data={actionData} intent="add-external-proof" />
                <SubmitButton className="f9-secondary-button" intent="add-external-proof" pendingLabel="Saving…">
                  Save evidence link
                </SubmitButton>
              </Form>

              <ActionFeedback data={actionData} intent="remove-item" />

              {data.advertiserFilter ? (
                <p className="f9-message is-success" role="status">
                  Showing saved ads matching “{data.advertiserFilter}”
                  {data.hiddenByAdvertiserFilter > 0
                    ? ` — ${data.hiddenByAdvertiserFilter} other saved ${
                        data.hiddenByAdvertiserFilter === 1 ? "ad is" : "ads are"
                      } hidden.`
                    : "."}{" "}
                  <Link to={`/app/collections?collection=${data.selectedCollection.id}`}>
                    Clear filter
                  </Link>
                </p>
              ) : null}

              {data.items.length === 0 && data.advertiserFilter ? (
                <EmptyState
                  description="No saved ads in this board match that competitor. Check another board on the left, or clear the filter to see everything saved here."
                  title="No saved ads match this filter"
                  variant="inline"
                />
              ) : data.items.length === 0 ? (
                <EmptyState
                  action={{ label: "Open search", to: "/search" }}
                  description="Save an evidence link here, or run a competitor search and save the examples your team needs to reuse."
                  title="Add evidence or save from search"
                />
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
                        <Pill>{formatMachineTokenLabel(item.ad.platforms?.[0] ?? item.ad.format ?? "")}</Pill>
                      </div>
                      <p>{item.ad.offer}</p>
                      {proofLinkForAd(item.ad) ? (
                        <p className="f9-muted-copy">
                          <a href={proofLinkForAd(item.ad) ?? undefined} rel="noreferrer" target="_blank">
                            Open evidence
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
                        <ActionFeedback
                          data={actionData}
                          intent="update-item"
                          match={{ itemId: item.id }}
                        />
                        <SubmitButton
                          className="f9-secondary-button"
                          intent="update-item"
                          match={{ itemId: item.id }}
                          pendingLabel="Saving…"
                        >
                          Save note and tags
                        </SubmitButton>
                      </Form>
                      <Form method="post">
                        <input name="intent" type="hidden" value="remove-item" />
                        <input name="itemId" type="hidden" value={item.id} />
                        <ConfirmSubmitButton
                          className="f9-secondary-button"
                          confirmLabel="Confirm — remove?"
                          intent="remove-item"
                          match={{ itemId: item.id }}
                          pendingLabel="Removing…"
                          variant="light"
                        >
                          Remove from collection
                        </ConfirmSubmitButton>
                      </Form>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState
              description="Group a competitor's best ads, offers, and landing-page evidence in one place — ready to reuse in a report or share with your team."
              title="Create your first evidence collection"
            />
          )}
        </article>
      </div>
      </section>
    </DashboardPage>
  );
}
