import { SecondaryAction, TertiaryAction } from "~/components/evidence/cta";

/**
 * Bulk action bar — brief §6.1.
 *
 * Selection is band-level now (the checkbox rail is gone), so this bar only
 * exists once something is selected, and it reads as counts instead of as an
 * instruction to go and select something. Pause/resume are Rank 2; clearing
 * the selection is Rank 3 because it is reversible and low-frequency (§5).
 */

export function BulkSelectBar(props: {
  selectedCount: number;
  pending: boolean;
  pendingAction: FormDataEntryValue | null | undefined;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
}) {
  if (props.selectedCount === 0) {
    return null;
  }

  const noun = props.selectedCount === 1 ? "competitor" : "competitors";

  return (
    <div aria-live="polite" className="f9-evidence-bulk-bar" role="status">
      <span className="f9-evidence-bulk-count f9-evidence-micro">
        {props.selectedCount} {noun} selected
      </span>
      <div className="f9-evidence-action-row">
        <SecondaryAction disabled={props.pending} onClick={props.onPause} small>
          {props.pending && props.pendingAction === "pause"
            ? `Pausing ${props.selectedCount}…`
            : `Pause ${props.selectedCount}`}
        </SecondaryAction>
        <SecondaryAction disabled={props.pending} onClick={props.onResume} small>
          {props.pending && props.pendingAction === "resume"
            ? `Resuming ${props.selectedCount}…`
            : `Resume ${props.selectedCount}`}
        </SecondaryAction>
        <TertiaryAction disabled={props.pending} onClick={props.onClear}>
          Clear selection
        </TertiaryAction>
      </div>
    </div>
  );
}
