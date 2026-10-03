import { type PasskeyState } from "../lib/use-passkey-sign-in";
import { Button } from "./ui/button";

export function PasskeyOption({ state, onSignIn }: { state: PasskeyState; onSignIn: () => Promise<void> }) {
  return (
    <>
      <Button
        type="button"
        variant="tertiary"
        className="mt-4 self-start"
        onClick={() => void onSignIn()}
        disabled={state === "working"}
      >
        {state === "working" ? "Follow your device's prompt…" : "Use a passkey instead"}
      </Button>
      {state === "failed" ? (
        <p role="alert" className="text-[0.95rem]">
          Your passkey didn't sign you in. Try it again, or use the email link.
        </p>
      ) : null}
    </>
  );
}
