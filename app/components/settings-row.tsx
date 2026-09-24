import { useState, type ReactElement } from "react";
import { useFetcher } from "react-router";

import { HOURS, WEEKDAYS, hourLabel } from "../lib/brief-settings";
import { Button } from "./ui/button";

const SELECT = "border-line h-11 border px-3";

export interface BriefRowProps {
  weekday: number;
  hour: number;
  timezone: string;
  nextBrief: string;
  timezones: readonly string[];
  error: string | null;
}

type BriefFetcher = ReturnType<typeof useFetcher<{ briefError: string | null }>>;

interface BriefFormProps {
  weekday: number;
  hour: number;
  timezone: string;
  timezones: readonly string[];
  fetcher: BriefFetcher;
  message: string | null;
}

function BriefForm({ weekday, hour, timezone, timezones, fetcher, message }: BriefFormProps): ReactElement {
  return (
    <fetcher.Form method="post" action="/app/settings" className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="intent" value="brief-schedule" />
      <select className={SELECT} name="weekday" aria-label="Brief day" defaultValue={weekday}>
        {WEEKDAYS.map((name, index) => (
          <option key={name} value={index}>
            {name}
          </option>
        ))}
      </select>
      <select className={SELECT} name="hour" aria-label="Brief hour" defaultValue={hour}>
        {HOURS.map((value) => (
          <option key={value} value={value}>
            {hourLabel(value)}
          </option>
        ))}
      </select>
      <select className={SELECT} name="timezone" aria-label="Timezone" defaultValue={timezone}>
        {timezones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      <Button type="submit" size="lg">
        Save
      </Button>
      {message === null ? null : (
        <p id="brief-row-error" role="alert" className="text-ink w-full text-body-sm">
          {message}
        </p>
      )}
    </fetcher.Form>
  );
}

export function BriefRow({
  weekday,
  hour,
  timezone,
  nextBrief,
  timezones,
  error,
}: BriefRowProps): ReactElement {
  const fetcher = useFetcher<{ briefError: string | null }>();
  const [editing, setEditing] = useState(error !== null);
  const [seen, setSeen] = useState<typeof fetcher.data>(undefined);
  const message = fetcher.data === undefined ? error : fetcher.data.briefError;
  const saved =
    editing &&
    fetcher.state === "idle" &&
    fetcher.data !== undefined &&
    fetcher.data !== seen &&
    fetcher.data.briefError === null;
  const open = editing && !saved;

  return (
    <section aria-labelledby="brief-row" className="border-line border-t py-4">
      <h2 id="brief-row" className="font-display text-lg font-semibold">
        Weekly brief
      </h2>
      {open ? (
        <BriefForm
          weekday={weekday}
          hour={hour}
          timezone={timezone}
          timezones={timezones}
          fetcher={fetcher}
          message={message}
        />
      ) : (
        <>
          <p className="text-body">
            {WEEKDAYS[weekday]} at {hourLabel(hour)}, {timezone}
          </p>
          <p className="text-ink-soft text-body-sm">Next brief: {nextBrief}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSeen(fetcher.data);
              setEditing(true);
            }}
          >
            Change
          </Button>
          {message === null ? null : (
            <p id="brief-row-error" role="alert" className="text-ink w-full text-body-sm">
              {message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
