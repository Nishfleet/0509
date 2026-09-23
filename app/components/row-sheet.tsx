import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";

export const rowSheetPopupClass =
  "fixed inset-x-0 bottom-0 z-50 h-[85dvh] overflow-y-auto border-t border-ink bg-card transition-transform duration-sheet-up ease-push data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full data-[ending-style]:duration-sheet-down motion-reduce:transition-none";

export const rowPanelClass =
  "border-l-4 border-green pl-4 transition-opacity duration-row ease-push motion-reduce:transition-none";

function subscribePhone(onStoreChange: () => void): () => void {
  const media = window.matchMedia("(max-width: 859px)");
  media.addEventListener("change", onStoreChange);
  return () => {
    media.removeEventListener("change", onStoreChange);
  };
}

function phoneSnapshot(): boolean {
  return window.matchMedia("(max-width: 859px)").matches;
}

function phoneServerSnapshot(): boolean {
  return false;
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, phoneSnapshot, phoneServerSnapshot);
}

export interface RowExpansionProps {
  title: string;
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function RowExpansion({
  title,
  summary,
  children,
  defaultOpen,
}: RowExpansionProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const phone = useIsPhone();

  return (
    <div data-slot="row">
      <button
        ref={triggerRef}
        type="button"
        data-slot="row-trigger"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
        className="block w-full min-h-11 text-left"
      >
        {summary}
      </button>
      {!phone && open ? (
        <div data-slot="row-panel" className={rowPanelClass}>
          {children}
        </div>
      ) : null}
      {phone ? (
        <Dialog.Root
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
          }}
        >
          <Dialog.Portal>
            <Dialog.Backdrop
              data-slot="row-sheet-backdrop"
              className="fixed inset-0 z-40 bg-ink/30 transition-opacity duration-sheet-up ease-push data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-reduce:transition-none"
            />
            <Dialog.Popup
              data-slot="row-sheet"
              finalFocus={triggerRef}
              className={rowSheetPopupClass}
            >
              <Dialog.Title className="p-4">{title}</Dialog.Title>
              <div className="px-4 pb-4">{children}</div>
              <Dialog.Close className="min-h-11 px-4">Close</Dialog.Close>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
