import { useEffect, useRef } from "react";
import { Link, useFetcher, useLocation } from "react-router";

import { ModalDialog } from "~/components/modal-dialog";

export interface QuickAddPaletteProps {
  onClose: () => void;
}

/** Heuristic only for choosing which form field to fill — the `/search`
 * action re-validates the website server-side either way. */
export function classifyQuickAddInput(raw: string): { field: "website" | "query"; value: string } {
  const value = raw.trim();
  if (value.includes(".") && !/\s/.test(value)) {
    return { field: "website", value };
  }
  return { field: "query", value };
}

/**
 * Cmd/Ctrl+K quick-add: one input, Enter creates the watchlist through the
 * existing `/search` create-watchlist action (plan limits, email-verification
 * gating, fingerprint dedupe, and the first activation scan all behave exactly
 * like the long path). On success the action redirects to the new watchlist;
 * the shell closes the palette on navigation.
 */
export function QuickAddPalette({ onClose }: QuickAddPaletteProps) {
  const fetcher = useFetcher<{
    ok: boolean;
    message?: string;
    error?: string;
    upgradePath?: string;
  }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const locationKeyRef = useRef(location.key);

  // The create action redirects to /app/watchlists?watchlist=<id>; when that
  // navigation lands, close the palette.
  useEffect(() => {
    if (location.key !== locationKeyRef.current) {
      onClose();
    }
  }, [location.key, onClose]);

  const pending = fetcher.state !== "idle";
  const feedback = !pending && fetcher.data && !fetcher.data.ok ? fetcher.data : null;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = inputRef.current?.value ?? "";
    if (!raw.trim() || pending) {
      return;
    }
    const { field, value } = classifyQuickAddInput(raw);
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("mode", "advertiser");
    formData.set("trackingRole", "competitor");
    formData.set(field, value);
    fetcher.submit(formData, { action: "/search", method: "post" });
  };

  return (
    <ModalDialog className="f9-quick-add-dialog" labelledBy="quick-add-title" onClose={onClose}>
      <form className="f9-quick-add-form" onSubmit={handleSubmit}>
        <h2 className="f9-wk-kick" id="quick-add-title">
          Add competitor
        </h2>
        <label className="f9-field">
          <span className="f9-sr-only">Competitor website or brand</span>
          <input
            autoComplete="off"
            data-autofocus
            disabled={pending}
            name="quickAddTarget"
            placeholder="Paste a competitor website or brand"
            ref={inputRef}
            spellCheck={false}
            type="text"
          />
        </label>
        <p className="f9-quick-add-hint">
          Enter creates the watchlist and opens it. Esc closes.
        </p>
        {feedback?.message ? (
          <p aria-live="polite" className="f9-wk-notice is-error" role="status">
            {feedback.message}
            {feedback.error === "plan_limit_exceeded" ? (
              <>
                {" "}
                <Link to={feedback.upgradePath ?? "/app/billing?source=search#plans"}>
                  View plans
                </Link>{" "}
                to raise the limit.
              </>
            ) : null}
          </p>
        ) : null}
        <div className="f9-quick-add-actions">
          <button className="f9-wk-btn-quiet" onClick={onClose} type="button">
            Cancel
          </button>
          <button aria-busy={pending || undefined} className="f9-wk-btn" disabled={pending} type="submit">
            {pending ? "Creating…" : "Track competitor"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
