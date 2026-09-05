import { Link, useActionData, useLoaderData, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { CollectionCreatePanel } from "~/components/collections/collection-create-panel";
import { CollectionDetailsSection } from "~/components/collections/collection-details-section";
import { CollectionEvidenceWorkspace } from "~/components/collections/collection-evidence-workspace";
import { CollectionExternalProofSection } from "~/components/collections/collection-external-proof-section";
import { CollectionSwitch } from "~/components/collections/collection-switch";
import { CopyButton } from "~/components/copy-button";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { WorkingHeader } from "~/components/workspace/working-header";
import { LocalTime } from "~/components/local-time";
import {
  buildCollectionFacts,
  collectionHref,
  formatCollectionsUsedValue,
  formatLockedActionsLabel,
  formatSavedItemsValue,
  latestSavedAt,
  resolveCollectionPrimarySlot,
} from "~/lib/collections-display";
import { matchesAdvertiserFilter } from "~/lib/watchlist-links";
import { canUsePlanFeature, getPlanLimit } from "~/lib/plan-entitlements";

// Re-exported for test-facing imports from "~/routes/app.collections" (same
// pattern as the watchlists route). Presentation logic lives in
// ~/lib/collections-display.
export {
  buildCollectionFacts,
  formatLockedActionsLabel,
  formatSavedItemsValue,
  resolveCollectionPrimarySlot,
};

export const meta = () => [{ title: "Library | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Library" />;
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
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
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
    renameCollection,
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

  if (intent === "rename-collection") {
    const collectionId = String(formData.get("collectionId") ?? "");
    const name = String(formData.get("name") ?? "").trim();

    if (!name) {
      return { ok: false, intent, message: "Give the collection a name first." };
    }

    const renamed = await renameCollection(env, workspaceUserId, collectionId, name);
    if (!renamed) {
      return {
        ok: false,
        intent,
        message: "That collection is no longer available.",
      };
    }

    return {
      ok: true,
      intent,
      message: `Renamed to ${renamed.name}.`,
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
      : { ok: false, intent, message: "We couldn't find that collection. Refresh the page and try again." };
  }

  if (intent === "remove-item") {
    const { deleteCollectionItem } = await import("~/lib/data.server");
    const itemId = String(formData.get("itemId") ?? "");
    const removed = await deleteCollectionItem(env, workspaceUserId, itemId);

    return removed
      ? { ok: true, intent, itemId, message: "Removed from the collection." }
      : { ok: false, intent, itemId, message: "We couldn't find that item. Refresh the page and try again." };
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
      return { ok: false, intent, message: "We couldn't find that collection. Refresh the page and try again." };
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
    message: "We couldn't complete that action. Refresh the page and try again.",
  };
}

export default function CollectionsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const plan = data.plan ?? "free";
  const collectionLimit = getPlanLimit(plan, "collections");
  const canCreateCollection = data.collections.length < collectionLimit;
  const canOpenReport = canUsePlanFeature(plan, "client_reports");
  const canExport =
    canUsePlanFeature(plan, "export_csv") && canUsePlanFeature(plan, "export_json");
  const canShare = canUsePlanFeature(plan, "share_links");
  const shareUrl =
    actionData && "shareUrl" in actionData && typeof actionData.shareUrl === "string"
      ? actionData.shareUrl
      : null;

  const selected = data.selectedCollection;
  const items = data.items;
  const hiddenByFilter = data.hiddenByAdvertiserFilter ?? 0;
  const newestSavedAt = latestSavedAt(items);
  const selectedItemId = searchParams.get("item");
  const selectedItem =
    items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;
  const actionIntent =
    actionData && "intent" in actionData && typeof actionData.intent === "string"
      ? actionData.intent
      : null;
  const createPanelOpen =
    searchParams.get("panel") === "new" || actionIntent === "create-collection";
  const primarySlot = resolveCollectionPrimarySlot({
    canCreate: canCreateCollection,
    hasCollections: data.collections.length > 0,
    hasItems: items.length + hiddenByFilter > 0,
    hasSelection: selected !== null,
  });

  const lockedActionsLabel = formatLockedActionsLabel(
    [
      !canOpenReport ? "client reports" : null,
      !canExport ? "exports" : null,
      !canShare ? "share links" : null,
    ].filter((label): label is string => label !== null),
  );

  const newCollectionParams = new URLSearchParams(searchParams);
  newCollectionParams.set("panel", "new");
  if (selected) newCollectionParams.set("collection", selected.id);
  const newCollectionHref =
    `/app/collections?${newCollectionParams.toString()}#new-collection`;

  const headerAction = selected && lockedActionsLabel
    ? {
        label: "View upgrade options",
        to: "/app/billing?source=collections#plans",
      }
    : selected && canCreateCollection
      ? { label: "New collection", to: newCollectionHref }
      : null;

  const feedbackMessage =
    actionData && "message" in actionData && typeof actionData.message === "string"
      ? actionData.message
      : null;
  const feedbackOk =
    Boolean(actionData && "ok" in actionData && actionData.ok);
  const feedbackIsPlanGate =
    Boolean(
      actionData &&
      "error" in actionData &&
      (actionData.error === "plan_gated" || actionData.error === "plan_limit_exceeded"),
    );
  const feedbackStrip = feedbackMessage ? (
    <FeedbackStrip
      actions={
        shareUrl ? (
          <>
            <a href={shareUrl} rel="noreferrer" target="_blank">
              Open share link
            </a>
            <CopyButton value={shareUrl} />
          </>
        ) : feedbackIsPlanGate ? (
          <Link className="f9-wk-lnk" to="/app/billing?source=collections#plans">
            View plans <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
          </Link>
        ) : null
      }
      label={feedbackOk ? "Done" : "Not done"}
      tone={feedbackOk ? "ok" : "bad"}
    >
      {feedbackMessage}
    </FeedbackStrip>
  ) : null;
  const createPanelVisible = selected
    ? canCreateCollection
    : primarySlot === "create";
  const createIntentFeedback =
    actionIntent === "create-collection" && createPanelVisible
      ? feedbackStrip
      : null;

  return (
    <DashboardPage className="f9-wk-page f9-library-page">
      <WorkingHeader
        action={headerAction}
        context={
          selected ? (
            <>
              {data.collections.length} {data.collections.length === 1 ? "collection" : "collections"}.
              {" "}{selected.name} holds {formatSavedItemsValue(items.length, hiddenByFilter) ?? "no saved evidence"}.
              {newestSavedAt ? (
                <> Last saved <LocalTime iso={newestSavedAt} mode="date" />.</>
              ) : null}
            </>
          ) : (
            "Saved evidence stays attached to its source, recorded date, and team notes."
          )
        }
        title="Library"
      />

      <CollectionSwitch
        advertiserFilter={data.advertiserFilter}
        collections={data.collections}
        selectedId={selected?.id ?? null}
      />

      {createIntentFeedback ? null : feedbackStrip}

      {selected ? (
        <>
          <CollectionEvidenceWorkspace
            advertiserFilter={data.advertiserFilter}
            collection={selected}
            hiddenByFilter={hiddenByFilter}
            items={items}
            selectedItem={selectedItem}
          />

          <CollectionDetailsSection
            canExport={canExport}
            canOpenReport={canOpenReport}
            canShare={canShare}
            collection={selected}
            collectionLimit={collectionLimit}
            collectionsUsed={data.collections.length}
            hiddenByFilter={hiddenByFilter}
            items={items}
            lockedActionsLabel={lockedActionsLabel}
          />

          <CollectionExternalProofSection
            collectionId={selected.id}
            defaultOpen={actionIntent === "add-external-proof"}
          />

          {canCreateCollection ? (
            <div id="new-collection">
              <CollectionCreatePanel
                defaultOpen={createPanelOpen}
                feedback={createIntentFeedback}
                mode="disclosure"
              />
            </div>
          ) : (
            <section aria-labelledby="collection-limit-title" className="f9-wk-sec f9-library-limit">
              <h2 className="f9-library-section-title" id="collection-limit-title">
                Collection limit reached
              </h2>
              <p className="f9-library-note">
                {`You are using all ${collectionLimit} ${collectionLimit === 1 ? "Collection" : "Collections"} on this plan. Delete one you no longer need, or compare plans to keep more evidence sets side by side.`}
              </p>
              <Link className="f9-wk-lnk" to="/app/billing?source=collections#plans">
                Compare plans <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
              </Link>
            </section>
          )}
        </>
      ) : primarySlot === "create" ? (
        <CollectionCreatePanel
          feedback={createIntentFeedback}
          mode="first-run"
        />
      ) : primarySlot === "gate" ? (
        <section aria-labelledby="collections-locked-title" className="f9-wk-sec f9-library-locked">
          <p className="f9-wk-kick">Scout plan</p>
          <h2 className="f9-library-section-title" id="collections-locked-title">
            Collections start on Scout
          </h2>
          <p className="f9-wk-lede">
            Keep an ad, its offer, its landing page, and the capture that proves it
            together for reports and team handoff. Nothing is hidden here because no
            collection exists on this plan yet.
          </p>
          <Link className="f9-wk-btn" to="/app/billing?source=collections#plans">
            Upgrade to Scout
          </Link>
        </section>
      ) : (
        <section
          aria-labelledby="collection-selection-missing-title"
          className="f9-wk-sec f9-library-empty"
        >
          <h2 className="f9-library-section-title" id="collection-selection-missing-title">
            That collection is no longer available
          </h2>
          <p className="f9-library-note">
            Choose another collection above.
          </p>
        </section>
      )}
    </DashboardPage>
  );
}
