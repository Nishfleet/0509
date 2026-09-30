import { lazy, Suspense, useState } from "react";
import type { ReactElement } from "react";

import { MissingShot, ShotImage, shotSrc } from "./capture-shot";
import type { CaptureShot } from "./capture-shot";

export { shotSrc };
export type { CaptureShot };

const CaptureDialog = lazy(() => import("./capture-dialog").then((module) => ({ default: module.CaptureDialog })));

export interface CapturePlateProps {
  label: string;
  before: CaptureShot;
  after: CaptureShot;
  eager?: boolean;
}

export function CapturePlate({ label, before, after, eager = false }: CapturePlateProps): ReactElement {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Open before and after: ${label}`}
        className="relative block h-[74px] w-[104px] shrink-0 overflow-hidden rounded-none border-[1.5px] border-line bg-card max-[859px]:h-[56px] max-[859px]:w-[76px]"
        data-slot="capture-plate"
        onClick={() => {
          setOpened(true);
        }}
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
      </button>
      {opened ? (
        <Suspense fallback={null}>
          <CaptureDialog
            label={label}
            before={before}
            after={after}
            onClose={() => {
              setOpened(false);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
