import { Collapsible } from "@base-ui/react/collapsible";
import { Drawer } from "@base-ui/react/drawer";
import { useRef, useState, useSyncExternalStore } from "react";

export const ROW_SHEET_BREAKPOINT_PX = 860;

export type RowExpansionMode = "sheet" | "in-place";

export function rowExpansionModeForWidth(widthPx: number): RowExpansionMode {
  return widthPx < ROW_SHEET_BREAKPOINT_PX ? "sheet" : "in-place";
}

function subscribeToWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
  };
}

function readExpansionMode(): RowExpansionMode {
  return rowExpansionModeForWidth(document.documentElement.clientWidth);
}

function readExpansionModeOnServer(): RowExpansionMode {
  return "sheet";
}

function useExpansionMode(): RowExpansionMode {
  return useSyncExternalStore(subscribeToWidth, readExpansionMode, readExpansionModeOnServer);
}

export interface RowSheetProps {
  label: string;
  children: React.ReactNode;
}

export function RowSheet({ label, children }: RowSheetProps) {
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

  return <RowSheetDrawer label={label}>{children}</RowSheetDrawer>;
}

interface RowSheetDrawerProps {
  label: string;
  children: React.ReactNode;
}

function RowSheetDrawer({ label, children }: RowSheetDrawerProps) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} modal swipeDirection="down">
      <Drawer.Trigger data-row-expansion="sheet">{label}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop
          data-row-sheet-backdrop=""
          className="fixed inset-0 z-40 bg-ink/30 transition-opacity duration-sheet-up ease-push data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-sheet-down"
        />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end">
          <Drawer.Popup
            ref={popupRef}
            data-row-sheet-popup=""
            initialFocus={popupRef}
            finalFocus
            className="h-[85%] w-full border-t border-t-ink bg-card outline-none transition-transform duration-sheet-up ease-push data-ending-style:duration-sheet-down data-ending-style:translate-y-full data-starting-style:translate-y-full"
          >
            <Drawer.Content>{children}</Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
