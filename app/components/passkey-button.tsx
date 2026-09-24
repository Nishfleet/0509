import { useState, type ReactElement } from "react";

import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";

export function AddPasskey({ className }: { className?: string }): ReactElement {
  const [state, setState] = useState<"idle" | "working" | "added" | "failed">("idle");

  async function addPasskey() {
    setState("working");
    const result = await authClient.passkey.addPasskey().catch(() => null);
    if (result && !result.error) {
      setState("added");
      return;
    }
    const code = result?.error && "code" in result.error ? result.error.code : "";
    setState(code === "ERROR_CEREMONY_ABORTED" ? "idle" : "failed");
  }

  return (
    <div className={className}>
      <Button type="button" variant="tertiary" onClick={() => void addPasskey()} disabled={state === "working"}>
        {state === "working" ? "Follow the prompt…" : "Add a passkey"}
      </Button>
      {state === "added" ? (
        <p role="status" className="text-[0.95rem]">
          Passkey added. Next time you can sign in with it, no email needed.
        </p>
      ) : null}
      {state === "failed" ? (
        <p role="alert" className="text-[0.95rem]">
          The passkey wasn't saved. Try again.
        </p>
      ) : null}
    </div>
  );
}
