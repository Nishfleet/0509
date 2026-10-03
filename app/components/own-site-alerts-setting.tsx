import type { ReactElement } from "react";
import { useId } from "react";
import { useFetcher } from "react-router";

import { BrandSwitch } from "./brand-switch";

const ROW = "mt-10 border-t border-line pt-4";
const NOTE = "mt-2 max-w-prose text-body-sm leading-[1.55] text-ink-soft";

interface AlertSwitchProps {
  on: boolean;
  intent: string;
  label: string;
  note: string;
  testId: string;
}

function AlertSwitch({ on, intent, label, note, testId }: AlertSwitchProps): ReactElement {
  const fetcher = useFetcher();
  const noteId = useId();

  return (
    <section className={ROW} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="flex-1 leading-[1.55]">{label}</span>
        <BrandSwitch
          state={on ? "on" : "off"}
          brandName={label}
          label={label}
          describedBy={noteId}
          onCheckedChange={(checked) => {
            void fetcher.submit({ intent, value: checked ? "on" : "off" }, { method: "post" });
          }}
        />
      </div>
      <p id={noteId} className={NOTE}>
        {note}
      </p>
    </section>
  );
}

export function OwnSiteAlertsSetting({ on }: { on: boolean }): ReactElement {
  return (
    <AlertSwitch
      on={on}
      intent="own-site-alerts"
      label="Immediate alerts for your own site"
      note="Off stops the email when your site looks broken. The alert still shows in Alerts."
      testId="own-site-alerts-setting"
    />
  );
}

export function ChangeAlertsSetting({ on }: { on: boolean }): ReactElement {
  return (
    <AlertSwitch
      on={on}
      intent="change-alerts"
      label="Immediate alerts when a rival changes price or plan"
      note="Off stops the email. The change still shows in Alerts and in your Monday brief."
      testId="change-alerts-setting"
    />
  );
}
