import { useEffect, useSyncExternalStore, type ReactElement } from "react";
import { useFetcher } from "react-router";

import { HOURS, WEEKDAYS, hourLabel } from "../lib/brief-settings";
import { BriefPauseSetting } from "./brief-pause-setting";
import { toastSaved } from "./toaster";
import { Button } from "./ui/button";

const SELECT =
  "min-h-11 rounded-none border-[1.5px] border-ink bg-card px-3 text-body text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green";
const LABEL = "font-mono text-meta text-ink-soft uppercase";

function subscribeToNothing(): () => void {
  return () => undefined;
}

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function noZoneOnServer(): null {
  return null;
}

export interface ScheduleView {
  weekday: number;
  hour: number;
  timezone: string;
  pausedAt: string | null;
  nextLine: string;
}

export function BriefScheduleSettings({ schedule }: { schedule: ScheduleView }): ReactElement {
  const fetcher = useFetcher<{ saved: boolean }>();
  const deviceZone = useSyncExternalStore(subscribeToNothing, browserZone, noZoneOnServer);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.saved === true) toastSaved("Brief time saved");
  }, [fetcher.state, fetcher.data]);

  const pending = fetcher.formData;
  const weekday = Number(pending?.get("weekday") ?? schedule.weekday);
  const hour = Number(pending?.get("hour") ?? schedule.hour);
  const pendingZone = pending?.get("timezone");
  const timezone = typeof pendingZone === "string" ? pendingZone : schedule.timezone;

  function save(next: { weekday?: number; hour?: number; timezone?: string }) {
    void fetcher.submit(
      {
        intent: "schedule",
        weekday: String(next.weekday ?? weekday),
        hour: String(next.hour ?? hour),
        timezone: next.timezone ?? timezone,
      },
      { method: "post" },
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Day</span>
          <select
            className={SELECT}
            value={weekday}
            onChange={(event) => {
              save({ weekday: Number(event.currentTarget.value) });
            }}
          >
            {WEEKDAYS.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Time</span>
          <select
            className={SELECT}
            value={hour}
            onChange={(event) => {
              save({ hour: Number(event.currentTarget.value) });
            }}
          >
            {HOURS.map((value) => (
              <option key={value} value={value}>
                {hourLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-ink-soft mt-3 text-body-sm">
        Time zone: <span className="text-ink [overflow-wrap:anywhere]">{timezone.replaceAll("_", " ")}</span>.{" "}
        {schedule.nextLine}.
      </p>
      {deviceZone !== null && deviceZone !== timezone ? (
        <Button
          type="button"
          variant="tertiary"
          className="whitespace-normal text-left"
          onClick={() => {
            save({ timezone: deviceZone });
          }}
        >
          Use this device&apos;s time zone ({deviceZone.replaceAll("_", " ")})
        </Button>
      ) : null}
      {fetcher.data?.saved === false ? (
        <p role="alert" className="mt-2 text-[0.95rem]">
          That time didn&apos;t save. Pick it again.
        </p>
      ) : null}
      <BriefPauseSetting pausedAt={schedule.pausedAt} timezone={schedule.timezone} />
    </div>
  );
}
