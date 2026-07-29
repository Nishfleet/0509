import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * BL-030 — the ⌘K palette lives in `app-layout` (it has to outlive route
 * transitions), so a rebuilt page that wants the palette as its one action
 * reads the opener off this context instead of re-implementing the dialog.
 *
 * `useQuickAdd()` returns null outside the provider, which is the honest
 * signal for "no palette here" — callers fall back to a real route rather
 * than rendering a button that does nothing.
 */
export interface QuickAddHandle {
  open: () => void;
}

const QuickAddContext = createContext<QuickAddHandle | null>(null);

export function QuickAddProvider({
  children,
  open,
}: {
  children: ReactNode;
  open: () => void;
}) {
  const value = useMemo<QuickAddHandle>(() => ({ open }), [open]);
  return <QuickAddContext.Provider value={value}>{children}</QuickAddContext.Provider>;
}

export function useQuickAdd(): QuickAddHandle | null {
  return useContext(QuickAddContext);
}
