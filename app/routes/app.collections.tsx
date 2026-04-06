import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { createReportId } from "~/lib/report";

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
  const { createCollection, createShareLink, getCollection, updateCollectionItem } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "create-collection") {
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    if (!name) {
      return { ok: false, message: "Collection name is required." };
    }

    const collectionLimit = await checkPlanLimit(env, session.user.id, "collections");
    if (!collectionLimit.allowed) {
      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: collectionLimit.limit,
        current: collectionLimit.current,
        message: "You have reached the free collection limit.",
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
      message: "Collection note updated.",
    };
  }

  if (intent === "share-collection") {
    const collectionId = String(formData.get("collectionId") ?? "");
    const collection = await getCollection(env, collectionId, session.user.id);
    if (!collection) {
      return { ok: false, message: "Collection not found." };
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
    message: "Unknown collections action.",
  };
}

export default function CollectionsRoute() {
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

      <div className="workspace-panels">
        <article className="content-card narrow-card">
          <div className="card-header">
            <div>
              <p className="section-label">Create collection</p>
              <h2>Keep the best ads reusable.</h2>
            </div>
          </div>

          <Form className="stack-form" method="post">
            <input name="intent" type="hidden" value="create-collection" />
            <label className="field">
              <span>Name</span>
              <input name="name" placeholder="Nykaa competitors" required />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea name="description" placeholder="Optional context for the team" rows={3} />
            </label>
            <button className="button button-primary" type="submit">
              Create collection
            </button>
          </Form>

          <div className="stack-list compact-list">
            {data.collections.map((collection) => (
              <Link
                className={`list-card ${searchParams.get("collection") === collection.id || (!searchParams.get("collection") && data.selectedCollection?.id === collection.id) ? "is-active" : ""}`}
                key={collection.id}
                to={`/app/collections?collection=${collection.id}`}
              >
                <div>
                  <h3>{collection.name}</h3>
                  <p className="muted-text">{collection.description || "No description yet."}</p>
                </div>
              </Link>
            ))}
          </div>
        </article>

        <article className="content-card">
          {data.selectedCollection ? (
            <>
              <div className="card-header">
                <div>
                  <p className="section-label">Selected collection</p>
                  <h2>{data.selectedCollection.name}</h2>
                </div>
                <div className="inline-actions">
                  <Link
                    className="button button-secondary"
                    to={`/app/reports/${createReportId("collection", data.selectedCollection.id)}`}
                  >
                    Open report
                  </Link>
                  <a
                    className="button button-secondary"
                    href={`/export/collection/${data.selectedCollection.id}`}
                  >
                    Export CSV
                  </a>
                  <Form method="post">
                    <input name="intent" type="hidden" value="share-collection" />
                    <input name="collectionId" type="hidden" value={data.selectedCollection.id} />
                    <button className="button button-primary" type="submit">
                      Create share link
                    </button>
                  </Form>
                </div>
              </div>

              {data.items.length === 0 ? (
                <p className="muted-text">
                  Save ads from the search page to populate this collection.
                </p>
              ) : (
                <div className="stack-list">
                  {data.items.map((item) => (
                    <article className="list-card" key={item.id}>
                      <div className="card-header">
                        <div>
                          <h3>{item.ad.advertiser}</h3>
                          <p className="muted-text">{item.ad.hook}</p>
                        </div>
                        <span className="badge">{item.ad.format}</span>
                      </div>
                      <p>{item.ad.offer}</p>
                      <p className="muted-text">
                        {item.tags.length > 0 ? item.tags.join(", ") : "No tags yet"}
                      </p>
                      <Form className="stack-form" method="post">
                        <input name="intent" type="hidden" value="update-item" />
                        <input name="itemId" type="hidden" value={item.id} />
                        <label className="field">
                          <span>Note</span>
                          <textarea defaultValue={item.note ?? ""} name="note" rows={3} />
                        </label>
                        <label className="field">
                          <span>Tags</span>
                          <input defaultValue={item.tags.join(", ")} name="tags" />
                        </label>
                        <button className="button button-secondary" type="submit">
                          Update item
                        </button>
                      </Form>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <h2>No collection selected</h2>
              <p>Create a collection or save an ad from search to get started.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
