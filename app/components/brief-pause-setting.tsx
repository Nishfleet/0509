import type { ReactElement } from "react";
import { useFetcher } from "react-router";

import { formatPausedSince } from "../lib/brief-settings";
import { Button } from "./ui/button";

export function BriefPauseSetting({ pausedAt, timezone }: { pausedAt: string | null; timezone: string }): ReactElement {
  const fetcher = useFetcher();
  return (
    <div className="mt-4">
      {pausedAt !== null ? (
        <p className="text-ink-soft text-body-sm">
          Paused since {formatPausedSince(pausedAt, timezone)}. Your ranking still updates; the email doesn't come.
        </p>
      ) : null}
      <fetcher.Form method="post" action="/app/settings/brief-pause">
        <input type="hidden" name="value" value={pausedAt === null ? "pause" : "resume"} />
        <Button type="submit" variant="secondary">
          {pausedAt === null ? "Pause the brief" : "Resume the brief"}
        </Button>
      </fetcher.Form>
    </div>
  );
}
