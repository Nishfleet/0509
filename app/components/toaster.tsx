import type { CSSProperties } from "react";
import { Toaster as SonnerToaster, toast } from "sonner";

const TOASTER_STYLE = {
  "--normal-bg": "var(--card)",
  "--normal-text": "var(--ink)",
  "--normal-border": "var(--line)",
  "--border-radius": "0px",
  fontFamily: "var(--font-sans)",
} as CSSProperties;

const UNDO_BUTTON_STYLE = { borderRadius: 0 } satisfies CSSProperties;

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      style={TOASTER_STYLE}
      toastOptions={{ actionButtonStyle: UNDO_BUTTON_STYLE }}
    />
  );
}

export function toastSaved(message: string, undo?: () => void): void {
  toast(message, {
    id: `saved:${message}`,
    action: undo === undefined ? undefined : { label: "Undo", onClick: undo },
  });
}
