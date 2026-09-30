import type { ReactElement } from "react";

import { HowRankedTable } from "./how-ranked-table";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import type { HowRanked } from "../lib/how-ranked";

export function HowRankedDialog({ howRanked, onClose }: { howRanked: HowRanked; onClose: () => void }): ReactElement {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto max-[859px]:top-auto max-[859px]:bottom-0 max-[859px]:left-0 max-[859px]:max-w-none max-[859px]:translate-x-0 max-[859px]:translate-y-0 max-[859px]:rounded-b-none sm:max-w-lg">
        <DialogTitle className="sr-only">How this is ranked</DialogTitle>
        <HowRankedTable howRanked={howRanked} />
      </DialogContent>
    </Dialog>
  );
}
