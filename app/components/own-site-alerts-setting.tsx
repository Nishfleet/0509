import type { ReactElement } from "react";
import { useFetcher } from "react-router";

import { Switch } from "./ui/switch";

const ROW = "border-line mt-10 border-t pt-4";
const NOTE = "text-ink-soft mt-2 max-w-prose text-body-sm leading-[1.55]";

export function OwnSiteAlertsSetting({ on }: { on: boolean }): ReactElement {
  const fetcher = useFetcher();

  return (
    <section className={ROW} data-testid="own-site-alerts-setting">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="flex-1 leading-[1.55]">Immediate alerts for your own site</span>
        <Switch
          checked={on}
          aria-label="Immediate alerts for your own site"
          onCheckedChange={(checked) => {
            void fetcher.submit({ intent: "own-site-alerts", value: checked ? "on" : "off" }, { method: "post" });
          }}
        />
      </div>
      <p className={NOTE}>Off stops the email when your site looks broken. The alert still shows in Alerts.</p>
    </section>
  );
}
