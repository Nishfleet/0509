import { useState } from "react";
import type { ReactElement } from "react";

import { AspectRatio } from "./ui/aspect-ratio";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";

export type CaptureShot = { src: string; capturedAt: string } | { missing: string };

export interface CapturePlateProps {
  label: string;
  before: CaptureShot;
  after: CaptureShot;
  eager?: boolean;
}

export function shotSrc(src: string, width: number): string {
  return `${src}${src.includes("?") ? "&" : "?"}w=${String(width)}`;
}

function MissingShot({ text }: { text: string }): ReactElement {
  return (
    <span
      className="flex size-full items-center justify-center p-1 text-center font-mono text-[0.6rem] leading-tight text-ink-soft"
      data-slot="capture-missing"
    >
      {text}
    </span>
  );
}

function ShotImage({
  src,
  width,
  height,
  loading,
  fetchPriority,
  className,
}: {
  src: string;
  width: number;
  height: number;
  loading: "eager" | "lazy";
  fetchPriority?: "high" | "auto";
  className: string;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) return <MissingShot text="Screenshot unavailable" />;
  return (
    <img
      alt=""
      className={className}
      decoding="async"
      fetchPriority={fetchPriority}
      height={height}
      loading={loading}
      onError={() => {
        setFailed(true);
      }}
      ref={(el) => {
        if (el !== null && el.complete && el.naturalWidth === 0) setFailed(true);
      }}
      src={src}
      width={width}
    />
  );
}

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

export function CapturePlate({
  label,
  before,
  after,
  eager = false,
}: CapturePlateProps): ReactElement {
  return (
    <Dialog>
      <DialogTrigger
        render={<button type="button" />}
        aria-label={`Open before and after: ${label}`}
        className="relative block shrink-0 overflow-hidden rounded-none border-[1.5px] border-line bg-card w-[104px] h-[74px] max-[859px]:w-[76px] max-[859px]:h-[56px]"
        data-slot="capture-plate"
      >
        {"src" in after ? (
          <ShotImage
            className="size-full object-cover object-top"
            fetchPriority={eager ? "high" : "auto"}
            height={74}
            loading={eager ? "eager" : "lazy"}
            src={shotSrc(after.src, 208)}
            width={104}
          />
        ) : (
          <MissingShot text={after.missing} />
        )}
      </DialogTrigger>
      <DialogContent
        className="rounded-none bg-card text-ink max-h-[90dvh] overflow-y-auto min-[860px]:max-w-[960px] max-[859px]:top-auto max-[859px]:bottom-0 max-[859px]:left-0 max-[859px]:w-full max-[859px]:max-w-none max-[859px]:translate-x-0 max-[859px]:translate-y-0"
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
