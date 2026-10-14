import { Form } from "react-router";

import type { SuppressionScope } from "../lib/mail-kind";
import { Footer } from "./footer";
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

const HEADING = "font-display text-2xl font-semibold tracking-[-0.02em]";
const BODY = "mt-4 leading-[1.65] text-ink-soft";

export function UnsubscribeConfirm({ scope, busy }: { scope: SuppressionScope; busy: boolean }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className={HEADING}>{TITLE[scope]}</h1>
      <p className={BODY}>
        You will stop getting {WHAT[scope]} from Five to Nine at this address. {STILL[scope]} Sign-in links still arrive
        when you ask for one.
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

export function UnsubscribeDone({ scope, busy }: { scope: SuppressionScope; busy: boolean }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className={HEADING}>You're unsubscribed</h1>
      <p className={BODY}>
        We won't send {WHAT[scope]} to this address any more. {STILL[scope]} Sign-in links still arrive when you ask for
        one.
      </p>
      {scope === "all" ? null : (
        <Form method="post" className="mt-6">
          <input type="hidden" name="scope" value="all" />
          <Button type="submit" variant="secondary" size="lg" disabled={busy}>
            {busy ? "Stopping…" : "Stop everything instead"}
          </Button>
        </Form>
      )}
      <p className={BODY}>
        Changed your mind? Sign in, open{" "}
        <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="/app/settings">
          Settings
        </a>
        , and switch it back on under "Emails to this address".
      </p>
      <Footer />
    </main>
  );
}
