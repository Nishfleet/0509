import { useState } from "react";
import { useNavigate } from "react-router";

import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";

export function SignOut() {
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  async function signOut() {
    setState("working");
    const result = await authClient.signOut().catch(() => null);
    if (result && !result.error) {
      await navigate("/login");
      return;
    }
    setState("failed");
  }

  return (
    <div>
      <Button type="button" variant="tertiary" onClick={() => void signOut()} disabled={state === "working"}>
        {state === "working" ? "Signing out…" : "Sign out"}
      </Button>
      {state === "failed" ? (
        <p role="alert" className="text-[0.95rem]">
          We couldn't sign you out. Try again.
        </p>
      ) : null}
    </div>
  );
}
