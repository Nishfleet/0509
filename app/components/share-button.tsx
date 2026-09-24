import { useState } from "react";
import type { ReactElement } from "react";

const SHARE_IMAGE_PATH = "/app/share.png";
const FILE_NAME = "0509-standing.png";

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = FILE_NAME;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

async function sharePicture(): Promise<boolean> {
  const response = await fetch(SHARE_IMAGE_PATH);
  if (!response.ok) return false;
  const file = new File([await response.blob()], FILE_NAME, { type: "image/png" });
  if ("canShare" in navigator && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file] }).catch(() => undefined);
    return true;
  }
  download(file);
  return true;
}

export function ShareButton(): ReactElement {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  async function share() {
    setState("working");
    const done = await sharePicture().catch(() => false);
    setState(done ? "idle" : "failed");
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        className="font-display border-ink border-[1.5px] px-3 py-2 uppercase"
        onClick={() => void share()}
        disabled={state === "working"}
      >
        {state === "working" ? "Making your picture…" : "Share my rank"}
      </button>
      {state === "failed" ? (
        <p role="alert" className="mt-2">
          We could not make the picture. Try again in a minute.
        </p>
      ) : null}
    </div>
  );
}
