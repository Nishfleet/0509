import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { useFetcher } from "react-router";

import { Button } from "./ui/button";

interface PasskeyItem {
  id: string;
  label: string;
}

function ConfirmRemove({
  label,
  busy,
  keepRef,
  onKeep,
}: {
  label: string;
  busy: boolean;
  keepRef: RefObject<HTMLButtonElement | null>;
  onKeep: () => void;
}): ReactElement {
  return (
    <span role="group" aria-label={`Confirm removing ${label}`} className="flex flex-wrap items-center gap-x-4">
      <span className="text-[0.95rem]">Remove this passkey?</span>
      <Button type="submit" variant="tertiary" disabled={busy} aria-label={`Yes, remove ${label}`}>
        Yes, remove
      </Button>
      <Button
        ref={keepRef}
        type="button"
        variant="tertiary"
        disabled={busy}
        aria-label={`Keep ${label}`}
        onClick={onKeep}
      >
        Keep
      </Button>
    </span>
  );
}

function useRowFocus(fetcher: { state: string; data?: unknown }) {
  const [confirming, setConfirming] = useState(false);
  const removeRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (returnFocus.current) removeRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) removeRef.current?.focus();
  }, [fetcher.state, fetcher.data]);

  function setConfirm(next: boolean) {
    returnFocus.current = !next;
    setConfirming(next);
  }

  return { confirming, setConfirm, removeRef, keepRef };
}

function PasskeyRow({ item }: { item: PasskeyItem }): ReactElement {
  const fetcher = useFetcher<{ passkeyError: string | null }>();
  const { confirming, setConfirm, removeRef, keepRef } = useRowFocus(fetcher);
  const busy = fetcher.state !== "idle";

  return (
    <li className="border-b border-line py-1">
      <fetcher.Form
        method="post"
        className="flex flex-wrap items-center justify-between gap-x-4"
        onSubmit={() => {
          setConfirm(false);
        }}
      >
        <input type="hidden" name="intent" value="passkey-remove" />
        <input type="hidden" name="passkeyId" value={item.id} />
        <span className="leading-[1.55]">{item.label}</span>
        {confirming ? (
          <ConfirmRemove
            label={item.label}
            busy={busy}
            keepRef={keepRef}
            onKeep={() => {
              setConfirm(false);
            }}
          />
        ) : (
          <Button
            ref={removeRef}
            type="button"
            variant="tertiary"
            disabled={busy}
            aria-label={`Remove ${item.label}`}
            onClick={() => {
              setConfirm(true);
            }}
          >
            Remove
          </Button>
        )}
      </fetcher.Form>
      {fetcher.data?.passkeyError ? (
        <p role="alert" className="text-[0.95rem] leading-[1.55]">
          {fetcher.data.passkeyError}
        </p>
      ) : null}
    </li>
  );
}

export function PasskeyList({ passkeys }: { passkeys: PasskeyItem[] }): ReactElement | null {
  if (passkeys.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="font-semibold">Your passkeys</h3>
      <ul className="mt-1 max-w-prose">
        {passkeys.map((item) => (
          <PasskeyRow key={item.id} item={item} />
        ))}
      </ul>
      <p className="mt-2 max-w-prose text-[0.95rem] leading-[1.55]">
        If you remove your last passkey, you can still sign in with the email link.
      </p>
    </div>
  );
}
