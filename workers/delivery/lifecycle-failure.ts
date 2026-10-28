import { captureException } from "@sentry/cloudflare";

import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";

export function reportLifecycleFailure(event: string, cause: unknown): void {
  const error = redactEmailShaped(cause instanceof Error ? cause.message : String(cause)).slice(0, 200);
  console.error(JSON.stringify({ event, error }));
  captureException(new Error(`${event}: ${error}`), { tags: { lane: "lifecycle", event } });
}
