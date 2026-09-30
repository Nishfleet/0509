import { useState } from "react";
import type { ReactElement } from "react";

export type CaptureShot = { src: string; capturedAt: string } | { missing: string };

export function shotSrc(src: string, width: number): string {
  return `${src}${src.includes("?") ? "&" : "?"}w=${String(width)}`;
}

export function MissingShot({ text }: { text: string }): ReactElement {
  return (
    <span
      className="flex size-full items-center justify-center p-1 text-center font-mono text-[0.6rem] leading-tight text-ink-soft"
      data-slot="capture-missing"
    >
      {text}
    </span>
  );
}

export function ShotImage({
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
