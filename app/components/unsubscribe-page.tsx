import { useEffect, useRef } from "react";
import { Form } from "react-router";

import type { SuppressionScope } from "../lib/mail-kind";
import { Footer, SUPPORT_ADDRESS } from "./footer";
import { Button } from "./ui/button";

const WHAT: Record<SuppressionScope, string> = {
  brief: "the weekly brief",
  alerts: "alerts",
  all: "the weekly brief and all alerts",
};

const STILL: Record<SuppressionScope, string> = {
  brief: "Alerts keep coming.",
  alerts: "The weekly brief keeps coming.",
  all: "",
};

const TITLE: Record<SuppressionScope, string> = {
  brief: "Stop the weekly brief?",
  alerts: "Stop alerts?",
  all: "Unsubscribe from Five to Nine emails?",
};

function what(scope: SuppressionScope, teammate: boolean): string {
  return teammate ? WHAT.brief : WHAT[scope];
}

const HEADING = "font-display text-2xl font-semibold tracking-[-0.02em]";
const BODY = "mt-4 leading-[1.65] text-ink-soft";

export function UnsubscribeConfirm({
  scope,
  teammate,
  busy,
}: {
  scope: SuppressionScope;
  teammate: boolean;
  busy: boolean;
}) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className={HEADING}>{TITLE[scope]}</h1>
      <p className={BODY}>
        You will stop getting {what(scope, teammate)} from Five to Nine at this address.
        {teammate ? "" : ` ${STILL[scope]} Sign-in links still arrive when you ask for one.`}
      </p>
      <Form method="post" className="mt-8">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Unsubscribing…" : "Unsubscribe"}
        </Button>
      </Form>
      <Footer />
    </main>
  );
}

function ChangedYourMind({ teammate }: { teammate: boolean }) {
  if (teammate) {
    return (
      <p className={BODY}>
        Changed your mind? Email{" "}
        <a
          className="inline-flex min-h-11 items-center underline underline-offset-4"
          href={`mailto:${SUPPORT_ADDRESS}`}
        >
          {SUPPORT_ADDRESS}
        </a>{" "}
        and we will sort it out.
      </p>
    );
  }
  return (
    <p className={BODY}>
      Changed your mind? Sign in, open{" "}
      <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="/app/settings">
        Settings
      </a>
      , and switch it back on under "Emails to this address". If your emails go to a different address than your
      sign-in, write to {SUPPORT_ADDRESS}.
    </p>
  );
}

function useFocusOnChange(key: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [key]);
  return ref;
}

export function UnsubscribeDone({
  scope,
  teammate,
  busy,
}: {
  scope: SuppressionScope;
  teammate: boolean;
  busy: boolean;
}) {
  const heading = useFocusOnChange(scope);
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 ref={heading} tabIndex={-1} className={HEADING}>
        You're unsubscribed
      </h1>
      <p className={BODY}>
        We won't send {what(scope, teammate)} to this address any more. {teammate ? "" : STILL[scope]}
        {teammate ? "" : " Sign-in links still arrive when you ask for one."}
      </p>
      {scope === "all" || teammate ? null : (
        <Form method="post" className="mt-6">
          <input type="hidden" name="scope" value="all" />
          <Button type="submit" variant="secondary" size="lg" disabled={busy}>
            {busy ? "Stopping…" : "Stop everything instead"}
          </Button>
        </Form>
      )}
      <ChangedYourMind teammate={teammate} />
      <Footer />
    </main>
  );
}
