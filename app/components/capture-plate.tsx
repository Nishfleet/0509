import { useState } from "react";
import { cn } from "@/lib/utils";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const CAPTURE_PLATE_DESKTOP = { width: 104, height: 74 } as const;
export const CAPTURE_PLATE_PHONE = { width: 76, height: 56 } as const;
const CAPTURE_PLATE_PHONE_MAX_PX = 859;
const CAPTURE_PAIR = { width: 480, height: 342 } as const;

export interface StoredCapture {
  objectKey: string;
  alt: string;
}
interface MissingCapture {
  missing: string;
}
export type CaptureFrame = StoredCapture | MissingCapture;

export function captureImageSrc(objectKey: string, width: number, height: number): string {
  const key = objectKey
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/media/${key}?width=${String(width)}&height=${String(height)}`;
}

function isStored(frame: CaptureFrame): frame is StoredCapture {
  return "objectKey" in frame;
}

export function CapturePlate({
  before,
  after,
  loading,
  label,
}: {
  before: CaptureFrame;
  after: CaptureFrame;
  loading: "eager" | "lazy";
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const thumb = isStored(after) || !isStored(before) ? after : before;

  function openPair() {
    setPhone(window.matchMedia(`(max-width: ${String(CAPTURE_PLATE_PHONE_MAX_PX)}px)`).matches);
    setOpen(true);
  }

  const pair = (
    <div className="grid min-w-0 gap-4 min-[860px]:grid-cols-2">
      <FrameView frame={before} caption="Before" />
      <FrameView frame={after} caption="After" />
    </div>
  );

  return (
    <>
      <button
        type="button"
        data-slot="capture-plate"
        aria-label={label}
        onClick={openPair}
        className="block cursor-pointer border-0 bg-transparent p-0"
      >
        <AspectRatio
          ratio={CAPTURE_PLATE_DESKTOP.width / CAPTURE_PLATE_DESKTOP.height}
          className="box-border h-[74px] w-[104px] overflow-hidden border border-line bg-card max-[859px]:h-[56px] max-[859px]:w-[76px]"
        >
          <Thumb frame={thumb} loading={loading} />
        </AspectRatio>
      </button>
      {open && phone ? (
        <Sheet open onOpenChange={setOpen}>
          <SheetContent side="bottom" className="h-[85%] overflow-y-auto rounded-none">
            <SheetHeader>
              <SheetTitle>{label}</SheetTitle>
              <SheetDescription>The before and after screenshots.</SheetDescription>
            </SheetHeader>
            {pair}
          </SheetContent>
        </Sheet>
      ) : null}
      {open && !phone ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto rounded-none sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
              <DialogDescription>The before and after screenshots.</DialogDescription>
            </DialogHeader>
            {pair}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function Thumb({ frame, loading }: { frame: CaptureFrame; loading: "eager" | "lazy" }) {
  if (!isStored(frame)) {
    return <Placeholder reason={frame.missing} className="size-full" />;
  }
  return (
    <CaptureImage
      frame={frame}
      width={CAPTURE_PLATE_DESKTOP.width}
      height={CAPTURE_PLATE_DESKTOP.height}
      loading={loading}
      fill
    />
  );
}

function FrameView({ frame, caption }: { frame: CaptureFrame; caption: string }) {
  return (
    <figure className="m-0 grid min-w-0 gap-2">
      <figcaption className="font-mono text-xs tracking-wide text-ink-soft uppercase">
        {caption}
      </figcaption>
      {isStored(frame) ? (
        <CaptureImage
          frame={frame}
          width={CAPTURE_PAIR.width}
          height={CAPTURE_PAIR.height}
          loading="eager"
          fill={false}
        />
      ) : (
        <Placeholder reason={frame.missing} className="h-[342px] w-full max-w-[480px]" />
      )}
    </figure>
  );
}

function CaptureImage({
  frame,
  width,
  height,
  loading,
  fill,
}: {
  frame: StoredCapture;
  width: number;
  height: number;
  loading: "eager" | "lazy";
  fill: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Placeholder
        reason="The screenshot did not load."
        className={fill ? "size-full" : "h-[342px] w-full max-w-[480px]"}
      />
    );
  }

  const desktop = captureImageSrc(frame.objectKey, CAPTURE_PLATE_DESKTOP.width, CAPTURE_PLATE_DESKTOP.height);
  const phone = captureImageSrc(frame.objectKey, CAPTURE_PLATE_PHONE.width, CAPTURE_PLATE_PHONE.height);
  const sized = captureImageSrc(frame.objectKey, width, height);
  const srcSet = `${phone} ${String(CAPTURE_PLATE_PHONE.width)}w, ${desktop} ${String(CAPTURE_PLATE_DESKTOP.width)}w`;
  const sizes = `(max-width: ${String(CAPTURE_PLATE_PHONE_MAX_PX)}px) ${String(CAPTURE_PLATE_PHONE.width)}px, ${String(CAPTURE_PLATE_DESKTOP.width)}px`;

  return (
    <img
      src={fill ? desktop : sized}
      srcSet={fill ? srcSet : undefined}
      sizes={fill ? sizes : undefined}
      width={width}
      height={height}
      alt={frame.alt}
      loading={loading}
      onError={() => {
        setFailed(true);
      }}
      className={fill ? "size-full object-cover" : "h-auto w-full max-w-[480px]"}
    />
  );
}

function Placeholder({ reason, className }: { reason: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={reason}
      className={cn(
        "flex items-center overflow-hidden bg-card p-1 text-left font-mono text-[10px] leading-tight text-ink-soft",
        className,
      )}
    >
      {reason}
    </span>
  );
}
