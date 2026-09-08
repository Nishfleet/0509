import { useState } from "react";
import { Link, useFetcher } from "react-router";

export interface ResultQuickSaveProps {
  adId: string;
  advertiser: string | null;
  plan: "free" | "scout" | "starter" | "agency" | null;
  collections: Array<{ id: string; name: string }>;
}

/**
 * One-click save from a search result card (workflow-friction pass): users
 * with a Collection save straight to their first board via the existing
 * save-to-collection action. Free includes 1 Collection (honest 1-coll), so
 * a free user with a board saves like everyone else; a free user without a
 * board yet gets the create-first note instead of an upgrade wall. The full
 * detail flow (choose board, note, tags) stays available in the detail aside.
 *
 * BL-014: this is the entry point into a collection, so it carries the
 * Rank-2 class pair rather than a fourth bespoke chip style (brief §5,
 * "the chip-that-is-secretly-a-button" is a retired style). `.f9-quick-save-
 * button` now carries only the card-reveal behaviour.
 *
 * BL-031: inside the v4 results list it is a text action, not a bordered
 * button. v4 removed per-row buttons from a ruled list — a box repeated once
 * per record is the card deck coming back in through the side door — so this
 * keeps its label, its `data-quick-save-ad` hook (the `s` shortcut clicks it)
 * and its 44px target, and gives up its frame.
 */
export function ResultQuickSave({ adId, advertiser, plan, collections }: ResultQuickSaveProps) {
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();
  const [showGate, setShowGate] = useState(false);
  const isFree = plan === "free";
  const targetCollection = collections[0] ?? null;
  const needsFirstCollection = isFree && !targetCollection;

  if (!plan || (!isFree && !targetCollection)) {
    return null;
  }

  const pending = fetcher.state !== "idle";
  const saved = Boolean(fetcher.data?.ok) && !pending;
  const failed = Boolean(fetcher.data && !fetcher.data.ok) && !pending;

  const handleClick = () => {
    if (needsFirstCollection) {
      setShowGate((open) => !open);
      return;
    }
    if (pending || saved || !targetCollection) {
      return;
    }
    const formData = new FormData();
    formData.set("intent", "save-to-collection");
    formData.set("adId", adId);
    formData.set("collectionId", targetCollection.id);
    fetcher.submit(formData, { action: "/search", method: "post" });
  };

  const label = pending ? "Saving…" : saved ? "Saved" : failed ? "Retry save" : "Save";

  return (
    <div className="f9-quick-save">
      <button
        aria-busy={pending || undefined}
        aria-label={
          needsFirstCollection
            ? "Save ad (create your free Collection first)"
            : `Save ${advertiser?.trim() || "this ad"} to ${targetCollection?.name ?? "your collection"}`
        }
        className="f9-wk-lnk f9-quick-save-button"
        data-quick-save-ad={adId}
        disabled={pending || saved}
        onClick={handleClick}
        type="button"
      >
        {label}
      </button>
      {needsFirstCollection && showGate ? (
        <span className="f9-quick-save-note" role="status">
          Free includes 1 Collection — create it in the Library to save ads.{" "}
          <Link to="/app/collections">Open the Library</Link>
        </span>
      ) : null}
      {failed && fetcher.data?.message ? (
        <span className="f9-quick-save-note is-error" role="status">
          {fetcher.data.message}
        </span>
      ) : null}
    </div>
  );
}
