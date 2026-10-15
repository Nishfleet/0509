import { useEffect, useRef } from "react";
import { Form, useFetcher, useNavigation } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";

interface Teammate {
  id: string;
  address: string;
  confirmed: boolean;
  unsubscribed: boolean;
}

function TeammateRow({ mate }: { mate: Teammate }) {
  const navigation = useNavigation();
  const removing = navigation.state !== "idle" && navigation.formData?.get("targetId") === mate.id;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2">
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {mate.address}
        {mate.unsubscribed ? <span className="text-ink-soft"> · unsubscribed</span> : null}
        {mate.confirmed || mate.unsubscribed ? null : (
          <span className="text-ink-soft"> · waiting for them to confirm</span>
        )}
      </span>
      <Form method="post" action="/app/settings">
        <input type="hidden" name="intent" value="teammate-remove" />
        <input type="hidden" name="targetId" value={mate.id} />
        <Button type="submit" variant="secondary" size="lg" aria-label={`Remove ${mate.address}`} disabled={removing}>
          {removing ? "Removing…" : "Remove"}
        </Button>
      </Form>
    </li>
  );
}

function InviteForm() {
  const fetcher = useFetcher<{ saved: boolean | null; teammateError: string | null }>();
  const formRef = useRef<HTMLFormElement>(null);
  const adding = fetcher.state !== "idle";
  const error = fetcher.data?.teammateError ?? null;
  const sent = fetcher.state === "idle" && fetcher.data?.saved === true;
  useEffect(() => {
    if (sent) formRef.current?.reset();
  }, [sent]);
  return (
    <fetcher.Form ref={formRef} method="post" action="/app/settings" className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="intent" value="teammate-add" />
      <label htmlFor="teammate-address" className="font-mono text-meta text-ink-soft uppercase">
        Teammate's email
      </label>
      <input
        id="teammate-address"
        name="address"
        type="email"
        autoComplete="off"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        className="h-11 border border-line px-3"
        aria-invalid={error === null ? undefined : true}
        aria-describedby={error === null ? undefined : "teammate-error"}
      />
      {error === null ? null : (
        <p id="teammate-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" size="lg" className="self-start" disabled={adding}>
        {adding ? "Sending…" : "Send invitation"}
      </Button>
      <p role="status">{sent ? "Invitation sent. They need to confirm by email." : null}</p>
    </fetcher.Form>
  );
}

export function Teammates({ teammates, limit }: { teammates: Teammate[]; limit: number }) {
  return (
    <section aria-labelledby="teammates" className="mt-10 border-t border-line pt-6">
      <h2 id="teammates" className={BLOCK_HEADING}>
        Also send the brief to
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        Up to {limit} teammates get the weekly brief too. They confirm by email first and can unsubscribe themselves.
        Alerts still come only to you, and a teammate only reads the brief: they can't change your plan, billing or
        rivals.
      </p>
      {teammates.length === 0 ? null : (
        <ul className="mt-3 max-w-prose">
          {teammates.map((mate) => (
            <TeammateRow key={mate.id} mate={mate} />
          ))}
        </ul>
      )}
      {teammates.length >= limit ? null : <InviteForm />}
    </section>
  );
}
