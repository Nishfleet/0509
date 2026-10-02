import { useState, type ReactElement } from "react";
import { useRevalidator } from "react-router";

import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";

interface PasskeyItem {
  id: string;
  label: string;
}

function PasskeyRow({ item, onResult }: { item: PasskeyItem; onResult: (removed: boolean) => void }): ReactElement {
  const [step, setStep] = useState<"idle" | "confirm" | "working">("idle");

  async function remove() {
    setStep("working");
    const result = await authClient.passkey.deletePasskey({ id: item.id }).catch(() => null);
    onResult(Boolean(result && !result.error));
    setStep("idle");
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 border-b border-line py-1">
      <span className="leading-[1.55]">{item.label}</span>
      {step === "idle" ? (
        <Button
          type="button"
          variant="tertiary"
          aria-label={`Remove ${item.label}`}
          onClick={() => {
            setStep("confirm");
          }}
        >
          Remove
        </Button>
      ) : (
        <span className="flex flex-wrap items-center gap-x-4">
          <span className="text-[0.95rem]">Remove this passkey?</span>
          <Button type="button" variant="tertiary" disabled={step === "working"} onClick={() => void remove()}>
            Yes, remove
          </Button>
          <Button
            type="button"
            variant="tertiary"
            disabled={step === "working"}
            onClick={() => {
              setStep("idle");
            }}
          >
            Keep
          </Button>
        </span>
      )}
    </li>
  );
}

export function PasskeyList({ passkeys }: { passkeys: PasskeyItem[] }): ReactElement | null {
  const revalidator = useRevalidator();
  const [failed, setFailed] = useState(false);
  if (passkeys.length === 0) return null;

  function onResult(removed: boolean) {
    setFailed(!removed);
    if (removed) void revalidator.revalidate();
  }

  return (
    <div className="mt-4">
      <h3 className="font-semibold">Your passkeys</h3>
      <ul className="mt-1 max-w-prose">
        {passkeys.map((item) => (
          <PasskeyRow key={item.id} item={item} onResult={onResult} />
        ))}
      </ul>
      {failed ? (
        <p role="alert" className="mt-1 text-[0.95rem]">
          The passkey wasn't removed. Try again.
        </p>
      ) : null}
      <p className="mt-2 max-w-prose text-[0.95rem] leading-[1.55]">
        If you remove your last passkey, you can still sign in with the email link.
      </p>
    </div>
  );
}
