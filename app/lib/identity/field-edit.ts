import type { PopoverRootChangeEventReason } from "@base-ui/react/popover";

export interface FieldEdit {
  committed: string;
  draft: string;
  open: boolean;
}

export type FieldEditAction =
  | { type: "open" }
  | { type: "change"; value: string }
  | { type: "key"; key: string; multiline: boolean }
  | { type: "dismiss"; reason: PopoverRootChangeEventReason }
  | { type: "save" }
  | { type: "cancel" };

export function closedFieldEdit(committed: string): FieldEdit {
  return { committed, draft: committed, open: false };
}

function saved(state: FieldEdit): FieldEdit {
  return { committed: state.draft, draft: state.draft, open: false };
}

function cancelled(state: FieldEdit): FieldEdit {
  return { ...state, draft: state.committed, open: false };
}

export function fieldEdit(state: FieldEdit, action: FieldEditAction): FieldEdit {
  switch (action.type) {
    case "open":
      return { ...state, draft: state.committed, open: true };
    case "change":
      return { ...state, draft: action.value };
    case "key":
      if (action.key === "Enter" && !action.multiline) return saved(state);
      if (action.key === "Escape") return cancelled(state);
      return state;
    case "dismiss":
      switch (action.reason) {
        case "trigger-press":
        case "outside-press":
          return saved(state);
        case "escape-key":
        case "trigger-hover":
        case "trigger-focus":
        case "focus-out":
        case "close-press":
        case "imperative-action":
        case "none":
          return cancelled(state);
      }
    case "save":
      return saved(state);
    case "cancel":
      return cancelled(state);
  }
}
