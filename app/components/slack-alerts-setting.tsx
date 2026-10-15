import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";

function slackSubmitting(navigation: ReturnType<typeof useNavigation>, connected: boolean): boolean {
  if (navigation.state === "idle") return false;
  const intent = connected ? "slack-remove" : "slack-save";
  return navigation.formData?.get("intent") === intent;
}

function ReconnectNote({ show, emailAlerts }: { show: boolean; emailAlerts: boolean }): ReactElement | null {
  return show ? (
    <p role="status" className="mt-2 max-w-prose leading-[1.55]" data-testid="slack-reconnect">
      Slack stopped accepting our posts, so we disconnected it. Paste a new webhook address to reconnect.{" "}
      {emailAlerts
        ? "Your alerts keep arriving by email."
        : "Price and plan alerts are off, so they are not sent by email or to Slack. Switch them on above."}
    </p>
  ) : null;
}

function WebhookField({ error }: { error: string | null }): ReactElement {
  return (
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
  );
}

export function SlackAlertsSetting({
  connected,
  revoked,
  emailAlerts,
  error,
}: {
  connected: boolean;
  revoked: boolean;
  emailAlerts: boolean;
  error: string | null;
}): ReactElement {
  const saving = slackSubmitting(useNavigation(), connected);
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
          ? "Price and plan changes, and your weekly brief, also post to your Slack channel."
          : "Post price and plan changes and your weekly brief to a Slack channel. Make an incoming webhook in Slack and paste its address here."}
      </p>
      <ReconnectNote show={revoked && !connected} emailAlerts={emailAlerts} />
      <Form method="post" action="/app/settings" className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="intent" value={connected ? "slack-remove" : "slack-save"} />
        {connected ? null : <WebhookField error={error} />}
        {error === null ? null : (
          <p id="slack-webhook-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" size="lg" className="self-start" disabled={saving}>
          {saving ? "Saving…" : connected ? "Disconnect Slack" : "Connect Slack"}
        </Button>
      </Form>
    </section>
  );
}
