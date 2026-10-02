import type { ReactElement } from "react";
import { Form } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";

export function SlackAlertsSetting({ connected, error }: { connected: boolean; error: string | null }): ReactElement {
  return (
    <section
      aria-labelledby="slack-alerts"
      className="mt-10 border-t border-line pt-6"
      data-testid="slack-alerts-setting"
    >
      <h2 id="slack-alerts" className={BLOCK_HEADING}>
        Slack alerts
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        {connected
          ? "Price and plan changes also post to your Slack channel."
          : "Post price and plan changes to a Slack channel. Make an incoming webhook in Slack and paste its address here."}
      </p>
      <Form method="post" action="/app/settings" className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="intent" value={connected ? "slack-remove" : "slack-save"} />
        {connected ? null : (
          <>
            <label htmlFor="slack-webhook-input" className="font-mono text-meta text-ink-soft uppercase">
              Slack webhook address
            </label>
            <input
              id="slack-webhook-input"
              name="webhook"
              type="url"
              required
              autoComplete="off"
              placeholder="https://hooks.slack.com/services/…"
              className="h-11 border border-line px-3"
              aria-invalid={error === null ? undefined : true}
              aria-describedby={error === null ? undefined : "slack-webhook-error"}
            />
          </>
        )}
        {error === null ? null : (
          <p id="slack-webhook-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" size="lg" className="self-start">
          {connected ? "Disconnect Slack" : "Connect Slack"}
        </Button>
      </Form>
    </section>
  );
}
