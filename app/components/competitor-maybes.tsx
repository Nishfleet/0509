import { useEffect, useRef, type ReactElement } from "react";
import { Form, useFetcher, useNavigation } from "react-router";

import type { PlanId } from "../lib/billing/plans";
import { BLOCK_HEADING } from "./page-heading";
import { CapRefusal } from "./cap-refusal";
import { Monogram } from "./monogram";
import { PlanGate } from "./plan-gate";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface Maybe {
  suggestionId: string;
  name: string;
  domain: string;
  reason: string | null;
}

export function CompetitorMaybes({ maybes }: { maybes: readonly Maybe[] }): ReactElement | null {
  if (maybes.length === 0) return null;
  return (
    <section aria-labelledby="maybes-heading" className="mt-12">
      <h2 id="maybes-heading" className={BLOCK_HEADING}>
        Possible competitors
      </h2>
      <p className="mt-1 text-body-sm text-ink-soft">We weren't sure these compete with you. Watch the ones that do.</p>
      <ul aria-label="Possible competitors" className="mt-3 border-b border-line">
        {maybes.map((maybe) => (
          <MaybeRow key={maybe.suggestionId} maybe={maybe} />
        ))}
      </ul>
    </section>
  );
}

function MaybeRow({ maybe }: { maybe: Maybe }): ReactElement {
  const fetcher = useFetcher<{ message: string | null; upgradePlanId?: string | null }>({
    key: `maybe-${maybe.suggestionId}`,
  });
  const busy = fetcher.state !== "idle";
  const watching = busy && fetcher.formData?.get("intent") === "accept";
  const dismissing = busy && fetcher.formData?.get("intent") === "dismiss";
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Monogram name={maybe.name} off />
        <div className="min-w-0">
          <p className="truncate font-display text-row-name font-bold">{maybe.name}</p>
          <p className="truncate text-body-sm text-ink-soft">{maybe.domain}</p>
          {maybe.reason === null ? null : <p className="mt-1 text-body-sm text-ink-soft">{maybe.reason}</p>}
        </div>
      </div>
      <fetcher.Form method="post" className="flex gap-2">
        <input type="hidden" name="suggestionId" value={maybe.suggestionId} />
        <Button
          type="submit"
          variant="secondary"
          name="intent"
          value="accept"
          aria-label={`Watch ${maybe.name}`}
          disabled={busy}
        >
          {watching ? "Watching…" : "Watch"}
        </Button>
        <Button
          type="submit"
          variant="tertiary"
          name="intent"
          value="dismiss"
          aria-label={`Dismiss ${maybe.name}`}
          className="px-2"
          disabled={busy}
        >
          {dismissing ? "Dismissing…" : "Dismiss"}
        </Button>
      </fetcher.Form>
      <CapRefusal result={fetcher.data} />
    </li>
  );
}

function useClearedAfterAdd(adding: boolean, message: string | null | undefined) {
  const formRef = useRef<HTMLFormElement>(null);
  const wasAdding = useRef(false);
  useEffect(() => {
    if (adding) wasAdding.current = true;
    else if (wasAdding.current) {
      wasAdding.current = false;
      if (!message) formRef.current?.reset();
    }
  }, [adding, message]);
  return formRef;
}

function AddNotice({
  message,
  added,
  unreachable,
  adding,
}: {
  message: string | null | undefined;
  added: boolean;
  unreachable: boolean;
  adding: boolean;
}): ReactElement | null {
  if (message) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p id="add-competitor-error" role="alert" className="text-[0.95rem]">
          {message}
        </p>
        {unreachable ? (
          <Button type="submit" name="anyway" value="1" variant="tertiary" disabled={adding}>
            Add it anyway
          </Button>
        ) : null}
      </div>
    );
  }
  if (!added) return null;
  return (
    <p role="status" className="mt-3 text-body-sm text-ink-soft">
      Added. We're reading their site now.
    </p>
  );
}

function AddInput({ invalid }: { invalid: boolean }): ReactElement {
  return (
    <Input
      id="add-competitor"
      name="competitor"
      placeholder="their website address"
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="go"
      className="sm:flex-1"
      aria-invalid={invalid ? true : undefined}
      aria-describedby={invalid ? "add-competitor-error" : undefined}
    />
  );
}

export function AddCompetitor({
  message,
  upgradePlanId,
  returning,
  added,
  unreachable,
}: {
  message: string | null | undefined;
  upgradePlanId?: PlanId | null | undefined;
  returning?: boolean | undefined;
  added?: boolean | undefined;
  unreachable?: boolean | undefined;
}): ReactElement {
  const navigation = useNavigation();
  const adding = navigation.state !== "idle" && navigation.formData?.get("intent") === "add";
  const formRef = useClearedAfterAdd(adding, message);
  return (
    <div className="mt-8">
      <Form method="post" ref={formRef}>
        <input type="hidden" name="intent" value="add" />
        <label htmlFor="add-competitor" className={BLOCK_HEADING}>
          Add a competitor we missed
        </label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <AddInput invalid={Boolean(message)} />
          <Button type="submit" variant="secondary" size="lg" disabled={adding}>
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>
        <AddNotice
          message={message}
          added={added === true && !adding}
          unreachable={unreachable === true}
          adding={adding}
        />
      </Form>
      {upgradePlanId ? <PlanGate planId={upgradePlanId} returning={returning === true} /> : null}
    </div>
  );
}
