import { useId, useState, useSyncExternalStore, type ReactElement } from "react";
import { useFetcher } from "react-router";

import { HOURS, WEEKDAYS, hourLabel } from "../lib/brief-settings";
import { Button } from "./ui/button";

const SELECT =
  "min-h-11 rounded-none border-[1.5px] border-ink bg-card px-3 text-body text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green";

function subscribeToNothing(): () => void {
  return () => undefined;
}

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function noZoneOnServer(): null {
  return null;
}

export interface BriefRowProps {
  weekday: number;
  hour: number;
  timezone: string;
  nextBrief: string;
  error: string | null;
}

export function BriefRow({ weekday, hour, timezone, nextBrief, error }: BriefRowProps): ReactElement {
  const fetcher = useFetcher<{ briefSaved: boolean; briefError: string | null }>();
  const errorId = useId();
  const deviceZone = useSyncExternalStore(subscribeToNothing, browserZone, noZoneOnServer);

  const [openedAt, setOpenedAt] = useState<typeof fetcher.data | undefined>(undefined);
  const saved = openedAt !== undefined && fetcher.data !== openedAt && fetcher.data?.briefSaved === true;
  const editing = openedAt !== undefined && !saved;

  const pending = fetcher.formData;
  const currentWeekday = Number(pending?.get("weekday") ?? weekday);
  const currentHour = Number(pending?.get("hour") ?? hour);
  const message = fetcher.data?.briefError ?? error;

  if (editing) {
    return (
      <fetcher.Form
        method="post"
        className="mt-3 flex flex-wrap items-center gap-3"
        aria-label="Change the weekly brief time"
        aria-describedby={message === null ? undefined : errorId}
      >
        <input type="hidden" name="intent" value="brief-schedule" />
        <input type="hidden" name="timezone" value={timezone} />
        <select
          className={SELECT}
          name="weekday"
          aria-label="Day of the week"
          defaultValue={currentWeekday}
          key={`weekday-${String(currentWeekday)}`}
        >
          {WEEKDAYS.map((name, index) => (
            <option key={name} value={index}>
              {name}
            </option>
          ))}
        </select>
        <select
          className={SELECT}
          name="hour"
          aria-label="Hour of the day"
          defaultValue={currentHour}
          key={`hour-${String(currentHour)}`}
        >
          {HOURS.map((value) => (
            <option key={value} value={value}>
              {hourLabel(value)}
            </option>
          ))}
        </select>
        <Button type="submit" size="lg">
          Save
        </Button>
        {message === null ? null : (
          <p className="text-ink w-full text-body-sm" id={errorId} role="alert">
            {message}
          </p>
        )}
      </fetcher.Form>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
      <p className="text-body">
        <span className="font-medium">
          {WEEKDAYS[weekday]} at {hourLabel(hour)}, {timezone.replaceAll("_", " ")}
        </span>
        <span className="text-ink-soft block text-body-sm">Next brief: {nextBrief}</span>
        {deviceZone !== null && deviceZone !== timezone ? (
          <span className="text-ink-soft mt-1 block text-body-sm">
            Your device is in {deviceZone.replaceAll("_", " ")}.
          </span>
        ) : null}
      </p>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setOpenedAt(fetcher.data);
        }}
      >
        Change
      </Button>
      {message === null ? null : (
        <p className="text-ink w-full text-body-sm" id={errorId} role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
