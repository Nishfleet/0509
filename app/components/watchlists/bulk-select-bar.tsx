// Workflow-friction pass: bulk pause/resume from the tracking desk.
export function BulkSelectBar(props: {
  selectedCount: number;
  pending: boolean;
  pendingAction: FormDataEntryValue | null | undefined;
  onPause: () => void;
  onResume: () => void;
}) {
  return (
    <div className="f9-bulk-bar">
      <span className="f9-muted-copy">
        {props.selectedCount > 0
          ? `${props.selectedCount} selected`
          : "Select watchlists for bulk actions"}
      </span>
      <div className="f9-inline-actions">
        <button
          aria-busy={props.pending || undefined}
          className="f9-secondary-button"
          disabled={props.selectedCount === 0 || props.pending}
          onClick={props.onPause}
          type="button"
        >
          {props.pending && props.pendingAction === "pause"
            ? "Pausing…"
            : "Pause selected"}
        </button>
        <button
          aria-busy={props.pending || undefined}
          className="f9-secondary-button"
          disabled={props.selectedCount === 0 || props.pending}
          onClick={props.onResume}
          type="button"
        >
          {props.pending && props.pendingAction === "resume"
            ? "Resuming…"
            : "Resume selected"}
        </button>
      </div>
    </div>
  );
}
