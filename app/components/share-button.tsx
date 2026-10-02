import { useState } from "react";
import type { ReactElement } from "react";

import { Button } from "./ui/button";

const SHARE_IMAGE_PATH = "/app/share.png";
const FILE_NAME = "five-to-nine-ranking.png";

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

export async function sharePicture(): Promise<boolean> {
  const response = await fetch(SHARE_IMAGE_PATH);
  if (!response.ok) return false;
  const file = new File([await response.blob()], FILE_NAME, { type: "image/png" });
  if ("canShare" in navigator && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return true;
      console.error(JSON.stringify({ event: "share.native_share_failed", error: String(error) }));
    }
  }
  download(file);
  return true;
}

export function ShareButton(): ReactElement {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  async function share() {
    setState("working");
    const done = await sharePicture().catch((error: unknown) => {
      console.error(JSON.stringify({ event: "share.picture_failed", error: String(error) }));
      return false;
    });
    setState(done ? "idle" : "failed");
  }

  return (
    <div className="mt-8">
      <Button type="button" variant="secondary" size="lg" onClick={() => void share()} disabled={state === "working"}>
        {state === "working" ? "Making your picture…" : "Share my rank"}
      </Button>
      {state === "failed" ? (
        <p role="alert" className="mt-2 text-[0.95rem]">
          We could not make the picture. Try again in a minute.
        </p>
      ) : null}
    </div>
  );
}
