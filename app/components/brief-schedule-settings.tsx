import { useEffect, useSyncExternalStore, type ReactElement } from "react";
import { useFetcher } from "react-router";

import { HOURS, WEEKDAYS, hourLabel } from "../lib/brief-settings";
import { BriefPauseSetting } from "./brief-pause-setting";
import { Toaster, toastSaved } from "./toaster";
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

interface ScheduleChange {
  weekday?: number;
  hour?: number;
  timezone?: string;
}

function useScheduleForm(schedule: ScheduleView) {
  const fetcher = useFetcher<{ saved: boolean }>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.saved === true) toastSaved("Brief time saved");
  }, [fetcher.state, fetcher.data]);

  const pending = fetcher.formData;
  const weekday = Number(pending?.get("weekday") ?? schedule.weekday);
  const hour = Number(pending?.get("hour") ?? schedule.hour);
  const pendingZone = pending?.get("timezone");
  const timezone = typeof pendingZone === "string" ? pendingZone : schedule.timezone;

  function save(next: ScheduleChange) {
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

  return { saved: fetcher.data?.saved, weekday, hour, timezone, save };
}

interface ScheduleSelectProps {
  label: string;
  value: number;
  options: readonly { value: number; text: string }[];
  onPick: (value: number) => void;
}

function ScheduleSelect({ label, value, options, onPick }: ScheduleSelectProps): ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <select
        className={SELECT}
        value={value}
        onChange={(event) => {
          onPick(Number(event.currentTarget.value));
        }}
      >
        {options.map((option) => (
          <option key={option.text} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
    </label>
  );
}

const DAY_OPTIONS = WEEKDAYS.map((text, value) => ({ value, text }));
const HOUR_OPTIONS = HOURS.map((value) => ({ value, text: hourLabel(value) }));

export function BriefScheduleSettings({ schedule }: { schedule: ScheduleView }): ReactElement {
  const form = useScheduleForm(schedule);
  const deviceZone = useSyncExternalStore(subscribeToNothing, browserZone, noZoneOnServer);

  return (
    <div className="mt-3">
      <Toaster />
      <div className="flex flex-wrap items-end gap-3">
        <ScheduleSelect
          label="Day"
          value={form.weekday}
          options={DAY_OPTIONS}
          onPick={(weekday) => {
            form.save({ weekday });
          }}
        />
        <ScheduleSelect
          label="Time"
          value={form.hour}
          options={HOUR_OPTIONS}
          onPick={(hour) => {
            form.save({ hour });
          }}
        />
      </div>
      <p className="mt-3 text-body-sm text-ink-soft">
        Time zone: <span className="[overflow-wrap:anywhere] text-ink">{form.timezone.replaceAll("_", " ")}</span>.{" "}
        {schedule.nextLine}.
      </p>
      {deviceZone !== null && deviceZone !== form.timezone ? (
        <Button
          type="button"
          variant="tertiary"
          className="text-left whitespace-normal"
          onClick={() => {
            form.save({ timezone: deviceZone });
          }}
        >
          Use this device&apos;s time zone ({deviceZone.replaceAll("_", " ")})
        </Button>
      ) : null}
      {form.saved === false ? (
        <p role="alert" className="mt-2 text-[0.95rem]">
          That time didn&apos;t save. Pick it again.
        </p>
      ) : null}
      <BriefPauseSetting pausedAt={schedule.pausedAt} timezone={schedule.timezone} />
    </div>
  );
}
