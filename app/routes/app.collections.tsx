import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { ActionFeedback } from "~/components/action-feedback";
import { CollectionCreatePanel } from "~/components/collections/collection-create-panel";
import {
  COLLECTION_PANEL_GROUP,
  CollectionDisclosure,
} from "~/components/collections/collection-disclosure";
import { CollectionSwitch } from "~/components/collections/collection-switch";
import { SavedEvidenceItem } from "~/components/collections/saved-evidence-item";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { CopyButton } from "~/components/copy-button";
import { FactRail } from "~/components/evidence/fact-rail";
import { QuietLine } from "~/components/evidence/quiet-line";
import { SecondaryAction, TertiaryAction } from "~/components/evidence/cta";
import { SpecimenEmptyState } from "~/components/evidence/specimen-empty-state";
import { StatusStrip, type StatusCell } from "~/components/evidence/status-strip";
import { LocalTime } from "~/components/local-time";
import { LockedFeature } from "~/components/locked-feature";
import { SubmitButton } from "~/components/submit-button";
import {
  COLLECTION_FILTERED_EMPTY_COPY,
  COLLECTION_ITEMS_EMPTY_COPY,
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
import { createReportId } from "~/lib/report";

// Re-exported for test-facing imports from "~/routes/app.collections" (same
// pattern as the watchlists route). Presentation logic lives in
// ~/lib/collections-display.
export {
  buildCollectionFacts,
  formatLockedActionsLabel,
  formatSavedItemsValue,
  resolveCollectionPrimarySlot,
};

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

  // Brief §5: one Rank-1 per screen. Every slot that wants a primary asks the
  // same resolver, and the losers drop to Rank 2.
  const primarySlot = resolveCollectionPrimarySlot({
    canCreate: canCreateCollection,
    hasCollections: data.collections.length > 0,
    hasSelection: Boolean(selected),
    hasItems: items.length > 0 || hiddenByFilter > 0,
  });

  // One nudge instead of an "Upgrade for X" button beside every locked action
  // — this is what retires the floating upgrade text link (§5).
  const lockedActionsLabel = formatLockedActionsLabel(
    [
      !canOpenReport ? "client reports" : null,
      !canExport ? "exports" : null,
      !canShare ? "share links" : null,
    ].filter((label): label is string => label !== null),
  );

  const statusCells: StatusCell[] = [
    {
      key: "Collection",
      value: selected?.name ?? null,
      missingLabel: "none selected yet",
    },
    {
      key: "Saved evidence",
      value: formatSavedItemsValue(items.length, hiddenByFilter),
      missingLabel: "nothing saved yet",
    },
    {
      key: "Last saved",
      value: newestSavedAt ? <LocalTime iso={newestSavedAt} /> : null,
      missingLabel: "no captures filed yet",
    },
    {
      key: "Collections",
      value: formatCollectionsUsedValue(data.collections.length, collectionLimit),
      missingLabel: "not included on this plan",
    },
  ];

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          kicker="Workspace memory"
          lead="Save the best competitor examples, external evidence, and notes for your team."
          title="Collections"
        />

        <ActionFeedback
          data={actionData}
          fallback
          planLimitTo="/app/billing?source=collections#plans"
        />
        <ActionFeedback data={actionData} intent="delete-collection" />

        {/* §6.3 — the one place page-level status renders on this surface. */}
        <StatusStrip
          action={
            data.advertiserFilter && selected
              ? { label: "Clear filter", to: collectionHref(selected.id) }
              : undefined
          }
          ariaLabel="Collections status"
          cells={statusCells}
        />

        <CollectionSwitch
          advertiserFilter={data.advertiserFilter}
          collections={data.collections}
          selectedId={selected?.id ?? null}
        />

        {/* §7 — the inversion: the saved evidence is the page. */}
        {selected ? (
          <div className="f9-ed-collection-layout">
            <div className="f9-ed-collection-main">
              <header className="f9-ed-collection-head">
                <div className="f9-ed-collection-head-title">
                  <span className="f9-ed-micro">Selected collection</span>
                  <h2 className="f9-ed-collection-name">{selected.name}</h2>
                  {selected.description ? (
                    <p className="f9-ed-collection-lead">{selected.description}</p>
                  ) : null}
                </div>
                <div className="f9-ed-action-row">
                  {canOpenReport ? (
                    <SecondaryAction
                      small
                      to={`/app/reports/${createReportId("collection", selected.id)}`}
                    >
                      Package for client
                    </SecondaryAction>
                  ) : null}
                  {/* §5 caps an action row at two or three Rank-2 controls, so
                      the two export formats are one control that reveals both
                      rather than two of the row's slots. */}
                  {canExport ? (
                    <CollectionDisclosure
                      className="f9-ed-collection-export"
                      group={COLLECTION_PANEL_GROUP}
                      summary="Export"
                    >
                      <SecondaryAction href={`/export/collection/${selected.id}`} small>
                        Export CSV
                      </SecondaryAction>
                      <SecondaryAction href={`/export/collection/${selected.id}?format=json`} small>
                        Export JSON
                      </SecondaryAction>
                    </CollectionDisclosure>
                  ) : null}
                  {canShare ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="share-collection" />
                      <input name="collectionId" type="hidden" value={selected.id} />
                      <SubmitButton
                        className="f9-ed-cta f9-ed-cta--rank2 is-small"
                        intent="share-collection"
                        pendingLabel="Creating…"
                      >
                        Create share link
                      </SubmitButton>
                    </Form>
                  ) : null}
                  {lockedActionsLabel ? (
                    <SecondaryAction small to="/app/billing?source=collections#plans">
                      {lockedActionsLabel}
                    </SecondaryAction>
                  ) : null}
                  <Form method="post">
                    <input name="intent" type="hidden" value="delete-collection" />
                    <input name="collectionId" type="hidden" value={selected.id} />
                    <ConfirmSubmitButton
                      className="f9-ed-cta f9-ed-cta--rank3 is-small"
                      confirmLabel="Confirm — delete collection?"
                      intent="delete-collection"
                      pendingLabel="Deleting…"
                      variant="light"
                    >
                      Delete collection
                    </ConfirmSubmitButton>
                  </Form>
                </div>
              </header>

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

              <ActionFeedback data={actionData} intent="remove-item" />

              {/* §6.7 — a filter that hides evidence is stated as one dashed
                  line, never as a green success banner. */}
              {data.advertiserFilter ? (
                <QuietLine
                  copy={
                    items.length === 0
                      ? COLLECTION_FILTERED_EMPTY_COPY
                      : `Showing saved evidence matching “${data.advertiserFilter}”.${
                          hiddenByFilter > 0
                            ? ` ${hiddenByFilter} other saved ${
                                hiddenByFilter === 1 ? "item is" : "items are"
                              } hidden.`
                            : ""
                        }`
                  }
                  stamp="Filter"
                />
              ) : null}

              {items.length > 0 ? (
                <div className="f9-ed-collection-items">
                  {items.map((item, index) => (
                    <SavedEvidenceItem
                      editor={
                        <>
                          <Form className="f9-ed-form" method="post">
                            <input name="intent" type="hidden" value="update-item" />
                            <input name="itemId" type="hidden" value={item.id} />
                            <label className="f9-field">
                              <span>Note</span>
                              <textarea defaultValue={item.note ?? ""} name="note" rows={2} />
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
                            <div className="f9-ed-action-row">
                              <SubmitButton
                                className="f9-ed-cta f9-ed-cta--rank2 is-small"
                                intent="update-item"
                                match={{ itemId: item.id }}
                                pendingLabel="Saving…"
                              >
                                Save note and tags
                              </SubmitButton>
                            </div>
                          </Form>
                          <Form method="post">
                            <input name="intent" type="hidden" value="remove-item" />
                            <input name="itemId" type="hidden" value={item.id} />
                            <ConfirmSubmitButton
                              className="f9-ed-cta f9-ed-cta--rank3 is-small"
                              confirmLabel="Confirm — remove?"
                              intent="remove-item"
                              match={{ itemId: item.id }}
                              pendingLabel="Removing…"
                              variant="light"
                            >
                              Remove from collection
                            </ConfirmSubmitButton>
                          </Form>
                        </>
                      }
                      item={item}
                      key={item.id}
                      number={index + 1}
                    />
                  ))}
                </div>
              ) : data.advertiserFilter ? null : (
                /* §6.8 — a panel, not a void: the state, what fills it, and a
                   numbered reserved slot so it reads as reserved. */
                <SpecimenEmptyState
                  copy={COLLECTION_ITEMS_EMPTY_COPY}
                  headingLevel={3}
                  headline="Nothing filed here yet"
                  primaryAction={
                    primarySlot === "items-empty"
                      ? { label: "Save evidence from search", to: "/search" }
                      : undefined
                  }
                  secondaryAction={
                    primarySlot === "items-empty"
                      ? undefined
                      : { label: "Save evidence from search", to: "/search" }
                  }
                  specimenLabel="Plate 01 — reserved"
                  stateLabel={`${selected.name} · nothing filed yet`}
                />
              )}

              {/* §7 — the 11-field evidence form is a Rank-2 reveal, not the
                  first thing on the page. */}
              <CollectionDisclosure
                className="f9-ed-collection-external"
                group={COLLECTION_PANEL_GROUP}
                summary="Add an evidence link"
              >
                <Form className="f9-ed-form" method="post">
                  <input name="intent" type="hidden" value="add-external-proof" />
                  <input name="collectionId" type="hidden" value={selected.id} />
                  <p className="f9-ed-form-lead">
                    External evidence — file an ad or landing page we do not scan ourselves. It
                    joins this collection with the date you saw it.
                  </p>
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
                  <div className="f9-ed-action-row">
                    <SubmitButton
                      className="f9-ed-cta f9-ed-cta--rank2"
                      intent="add-external-proof"
                      pendingLabel="Saving…"
                    >
                      Save evidence link
                    </SubmitButton>
                  </div>
                </Form>
              </CollectionDisclosure>
            </div>

            {/* §6.6 — ONE fact rail, edited down. This is the row-for-box swap
                that deletes the six-box insight grid from this route. */}
            <aside className="f9-ed-collection-rail">
              <FactRail
                rows={buildCollectionFacts({
                  collection: selected,
                  collectionLimit,
                  collectionsUsed: data.collections.length,
                  hiddenByFilter,
                  items,
                })}
                title="This collection"
              />
            </aside>
          </div>
        ) : null}

        {primarySlot === "gate" ? (
          <LockedFeature
            eyebrow="Collections"
            headingLevel="h2"
            planNeeded="Scout plan"
            reason="A collection keeps the ad, the offer and the landing page exactly as we captured them, ready to reuse in a client report"
            specimen={
              <p className="f9-ed-specimen-copy">
                Saved evidence renders as numbered plates — the capture, its offer and call to
                action, and the time we took it.
              </p>
            }
            specimenLabel="Included from Scout"
            title="Collections are not included on this plan"
            upgradeLabel="Upgrade to Scout"
            upgradeTo="/app/billing?source=collections#plans"
          />
        ) : canCreateCollection ? (
          <CollectionCreatePanel
            feedback={
              <ActionFeedback
                data={actionData}
                intent="create-collection"
                planLimitTo="/app/billing?source=collections#plans"
              />
            }
            mode={primarySlot === "create" ? "first-run" : "disclosure"}
          />
        ) : (
          /* At the plan's limit, with boards full of evidence: a Rank-2 note
             beside the content, never a wall over it (§5, WP-B1). */
          <section className="f9-ed-panel f9-ed-collection-limit">
            <header className="f9-ed-plate-header f9-ed-micro">
              <span>Collections · limit reached</span>
            </header>
            <div className="f9-ed-specimen-body">
              <p className="f9-ed-specimen-copy">
                You are using all {collectionLimit} collections on this plan. Delete one you no
                longer need, or move up a plan to keep more evidence sets side by side.
              </p>
              <div className="f9-ed-action-row">
                <SecondaryAction to="/app/billing?source=collections#plans">
                  View plans
                </SecondaryAction>
              </div>
            </div>
          </section>
        )}
      </section>
    </DashboardPage>
  );
}
