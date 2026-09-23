import type { Route } from "./+types/settings.card";

import { requireSession } from "../lib/require-session.server";
import {
  publishCard,
  readCardSettings,
  readWorkspaceIdForOwner,
  rotateCardSlug,
  unpublishCard,
} from "../lib/data/workspace.server";

interface CardState {
  published: boolean;
  slug: string | null;
  url: string | null;
  rotated: string | null;
  error: string | null;
}

const EMPTY: CardState = { published: false, slug: null, url: null, rotated: null, error: null };

function cardState(
  settings: { published: boolean; slug: string | null },
  rotated: string | null,
  error: string | null,
): CardState {
  return {
    published: settings.published,
    slug: settings.slug,
    url: settings.slug === null ? null : `/s/${settings.slug}`,
    rotated,
    error,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) return { card: EMPTY, hasWorkspace: false };

  const settings = await readCardSettings(workspaceId);
  if (settings === null) return { card: EMPTY, hasWorkspace: true };
  return { card: cardState(settings, null, null), hasWorkspace: true };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) return { card: EMPTY, hasWorkspace: false };

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "publish") {
    const settings = await publishCard(workspaceId);
    if (settings === null) return { card: EMPTY, hasWorkspace: true };
    return { card: cardState(settings, null, null), hasWorkspace: true };
  }

  if (intent === "unpublish") {
    await unpublishCard(workspaceId);
    const settings = await readCardSettings(workspaceId);
    return { card: cardState(settings ?? EMPTY, null, null), hasWorkspace: true };
  }

  if (intent === "rotate") {
    const slug = await rotateCardSlug(workspaceId);
    if (slug === null) {
      const settings = await readCardSettings(workspaceId);
      return {
        card: {
          ...cardState(settings ?? EMPTY, null, null),
          error: "A new URL could not be claimed. The old one still works.",
        },
        hasWorkspace: true,
      };
    }
    return { card: cardState({ published: true, slug }, slug, null), hasWorkspace: true };
  }

  const settings = await readCardSettings(workspaceId);
  return { card: cardState(settings ?? EMPTY, null, null), hasWorkspace: true };
}

function CopyButton({ url }: { url: string | null }) {
  return (
    <button
      type="button"
      disabled={url === null}
      onClick={() => {
        if (url !== null) void navigator.clipboard.writeText(`${location.origin}${url}`);
      }}
    >
      Copy link
    </button>
  );
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const card = actionData?.card ?? loaderData.card;

  return (
    <main>
      <h1>Public card</h1>
      {!loaderData.hasWorkspace ? <p>Your workspace is still being set up.</p> : null}
      {loaderData.hasWorkspace && card.error !== null ? <p role="alert">{card.error}</p> : null}
      {loaderData.hasWorkspace && !card.published ? (
        <form method="post">
          <input type="hidden" name="intent" value="publish" />
          <button type="submit">Turn the public card on</button>
        </form>
      ) : null}
      {card.published ? (
        <>
          <p>
            <a href={card.url ?? ""}>{card.url ?? ""}</a>
            {card.rotated !== null ? " (new URL)" : null}
          </p>
          <CopyButton url={card.url} />
          <form method="post">
            <input type="hidden" name="intent" value="rotate" />
            <button type="submit">New URL</button>
          </form>
          <form method="post">
            <input type="hidden" name="intent" value="unpublish" />
            <button type="submit">Turn the public card off</button>
          </form>
        </>
      ) : null}
    </main>
  );
}
