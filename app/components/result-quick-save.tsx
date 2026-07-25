import { useState } from "react";
import { Link, useFetcher } from "react-router";

export interface ResultQuickSaveProps {
  adId: string;
  advertiser: string | null;
  plan: "free" | "scout" | "starter" | "agency" | null;
  collections: Array<{ id: string; name: string }>;
}

/**
 * One-click save from a search result card (workflow-friction pass): paid
 * users save straight to their first board via the existing
 * save-to-collection action; free users get the existing plan-gate copy
 * inline. The full detail flow (choose board, note, tags) stays available in
 * the detail aside.
 */
export function ResultQuickSave({ adId, advertiser, plan, collections }: ResultQuickSaveProps) {
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();
  const [showGate, setShowGate] = useState(false);
  const isFree = plan === "free";
  const targetCollection = collections[0] ?? null;

  if (!plan || (!isFree && !targetCollection)) {
    return null;
  }

  const pending = fetcher.state !== "idle";
  const saved = Boolean(fetcher.data?.ok) && !pending;
  const failed = Boolean(fetcher.data && !fetcher.data.ok) && !pending;

  const handleClick = () => {
    if (isFree) {
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
          isFree
            ? "Save ad (paid plans)"
            : `Save ${advertiser?.trim() || "this ad"} to ${targetCollection?.name ?? "your collection"}`
        }
        className="f9-quick-save-button"
        data-quick-save-ad={adId}
        disabled={pending || saved}
        onClick={handleClick}
        type="button"
      >
        {label}
      </button>
      {isFree && showGate ? (
        <span className="f9-quick-save-note" role="status">
          Upgrade to Scout to save ads and build your workspace memory.{" "}
          <Link to="/app/billing?source=search#plans">View plans</Link>
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
