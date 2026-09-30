import { useState } from "react";
import { useNavigate } from "react-router";

import { authClient } from "./auth-client";

export type PasskeyState = "idle" | "working" | "failed";

export function usePasskeySignIn(target: string): { state: PasskeyState; signIn: () => Promise<void> } {
  const navigate = useNavigate();
  const [state, setState] = useState<PasskeyState>("idle");

  async function signIn() {
    setState("working");
    const result = await authClient.signIn.passkey().catch((error: unknown) => {
      console.error(JSON.stringify({ event: "login.passkey_sign_in_failed", error: String(error) }));
      return null;
    });
    if (result && !result.error) {
      await navigate(target);
      return;
    }
    const code = result?.error && "code" in result.error ? result.error.code : "";
    setState(code === "AUTH_CANCELLED" ? "idle" : "failed");
  }

  return { state, signIn };
}
