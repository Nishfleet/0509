import type { ReactElement } from "react";

import { MissingShot, ShotImage, shotSrc } from "./capture-shot";
import type { CaptureShot } from "./capture-shot";
import { AspectRatio } from "./ui/aspect-ratio";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

function PairFigure({ caption, shot }: { caption: string; shot: CaptureShot }): ReactElement {
  return (
    <figure>
      <AspectRatio ratio={1440 / 900}>
        {"src" in shot ? (
          <ShotImage
            className="size-full object-cover object-top"
            height={900}
            loading="lazy"
            src={shotSrc(shot.src, 1440)}
            width={1440}
          />
        ) : (
          <MissingShot text={shot.missing} />
        )}
      </AspectRatio>
      <figcaption className="font-mono text-[0.7rem] text-ink-soft">
        {"src" in shot ? `${caption} · ${shot.capturedAt}` : caption}
      </figcaption>
    </figure>
  );
}

export function CaptureDialog({
  label,
  before,
  after,
  onClose,
}: {
  label: string;
  before: CaptureShot;
  after: CaptureShot;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto rounded-none bg-card text-ink max-[859px]:top-auto max-[859px]:bottom-0 max-[859px]:left-0 max-[859px]:w-full max-[859px]:max-w-none max-[859px]:translate-x-0 max-[859px]:translate-y-0 min-[860px]:max-w-[960px]"
        data-slot="capture-pair"
      >
        <DialogTitle>{label}</DialogTitle>
        <div className="grid gap-4 min-[860px]:grid-cols-2">
          <PairFigure caption="Before" shot={before} />
          <PairFigure caption="After" shot={after} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
