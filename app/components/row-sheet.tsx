import { Collapsible } from "@base-ui/react/collapsible";
import { Drawer } from "@base-ui/react/drawer";
import { useRef, useState, useSyncExternalStore } from "react";

export const ROW_SHEET_BREAKPOINT_PX = 860;

export type RowExpansionMode = "sheet" | "in-place";

export function rowExpansionModeForWidth(widthPx: number): RowExpansionMode {
  return widthPx < ROW_SHEET_BREAKPOINT_PX ? "sheet" : "in-place";
}

// The one query the runtime subscribes to. The unit test asserts it is built
// from ROW_SHEET_BREAKPOINT_PX, so the constant cannot drift from the query.
export function rowSheetWidthQuery(): string {
  return `(min-width: ${String(ROW_SHEET_BREAKPOINT_PX)}px)`;
}

function subscribeToWidth(onChange: () => void): () => void {
  const query = window.matchMedia(rowSheetWidthQuery());
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

function readExpansionMode(): RowExpansionMode {
  // matchMedia resolves the boundary on the layout viewport, which excludes a
  // classic scrollbar; window.innerWidth would include it. The query already
  // answered the question, so the helper is fed the value it resolved.
  const atOrAboveBreakpoint = window.matchMedia(rowSheetWidthQuery()).matches;
  return rowExpansionModeForWidth(
    atOrAboveBreakpoint ? ROW_SHEET_BREAKPOINT_PX : ROW_SHEET_BREAKPOINT_PX - 1,
  );
}

function useExpansionMode(): RowExpansionMode {
  return useSyncExternalStore(subscribeToWidth, readExpansionMode, () => "sheet");
}

export interface RowSheetProps {
  rowId: string;
  label: string;
  children: React.ReactNode;
}

export function RowSheet({ rowId, label, children }: RowSheetProps) {
  const mode = useExpansionMode();

  if (mode === "in-place") {
    return (
      <Collapsible.Root
        data-row-expansion="in-place"
        data-row-expansion-accent=""
        className="border-b border-b-line border-l-4 border-l-green"
      >
        <Collapsible.Trigger className="w-full text-left">{label}</Collapsible.Trigger>
        <Collapsible.Panel>{children}</Collapsible.Panel>
      </Collapsible.Root>
    );
  }

  return (
    <RowSheetDrawer rowId={rowId} label={label}>
      {children}
    </RowSheetDrawer>
  );
}

interface RowSheetDrawerProps {
  rowId: string;
  label: string;
  children: React.ReactNode;
}

function RowSheetDrawer({ rowId, label, children }: RowSheetDrawerProps) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={setOpen}
      modal
      swipeDirection="down"
      triggerId={`row-sheet-trigger-${rowId}`}
    >
      <Drawer.Trigger
        id={`row-sheet-trigger-${rowId}`}
        data-row-expansion="sheet"
        aria-controls="row-sheet-popup"
      >
        {label}
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop
          data-row-sheet-backdrop=""
          className="fixed inset-0 z-40 bg-ink/30 transition-opacity duration-sheet-up ease-push data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-sheet-down"
        />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end">
          <Drawer.Popup
            ref={popupRef}
            id="row-sheet-popup"
            data-row-sheet-popup=""
            initialFocus={popupRef}
            finalFocus={true}
            className="h-[85%] w-full border-t border-t-ink bg-card outline-none transition-transform duration-sheet-up ease-push data-ending-style:duration-sheet-down data-ending-style:translate-y-full data-starting-style:translate-y-full"
          >
            <Drawer.Content>{children}</Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
