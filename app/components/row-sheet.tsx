import type { ReactElement } from "react";
import { useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";

import { RowEvidence } from "./row-evidence";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import type { WeekEvidence } from "../lib/home-standing";

const NARROW = "(max-width: 859px)";

function subscribeToNarrow(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

function narrowInBrowser(): boolean {
  return window.matchMedia(NARROW).matches;
}

function notNarrowOnServer(): boolean {
  return false;
}

export function RowSheet({
  title,
  evidence,
}: {
  title: string;
  evidence: readonly WeekEvidence[];
}): ReactElement {
  const narrow = useSyncExternalStore(subscribeToNarrow, narrowInBrowser, notNarrowOnServer);
  const [, setSearchParams] = useSearchParams();

  function close(): void {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("open");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }

  return (
    <Dialog
      open={narrow}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        data-slot="row-sheet"
        className="rounded-none bg-card text-ink h-[85dvh] overflow-y-auto border-t-[1.5px] border-ink top-auto bottom-0 left-0 w-full max-w-none translate-x-0 translate-y-0 min-[860px]:hidden"
      >
        <DialogTitle>{title}</DialogTitle>
        <RowEvidence evidence={evidence} />
      </DialogContent>
    </Dialog>
  );
}
