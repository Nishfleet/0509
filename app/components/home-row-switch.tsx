import type { ReactElement } from "react";
import { useFetcher } from "react-router";

import { BrandSwitch } from "./brand-switch";
import { rowSwitchView } from "../lib/home-switch";
import { useHoldNavigation } from "../lib/use-hold-navigation";

export function HomeRowSwitch({
  entityId,
  name,
  self,
}: {
  entityId: string;
  name: string;
  self: boolean;
}): ReactElement {
  const fetcher = useFetcher<{ message: string | null }>();
  useHoldNavigation(fetcher.state === "submitting");
  const view = rowSwitchView({ self, name, formData: fetcher.formData, message: fetcher.data?.message });
  return (
    <>
      <BrandSwitch
        state={view.state}
        brandName={name}
        onCheckedChange={(checked) => {
          void fetcher.submit(
            { intent: checked ? "on" : "off", entityId },
            { method: "post", action: "/app/competitors" },
          );
        }}
      />
      {view.pendingNote === null ? null : (
        <p role="status" data-slot="row-switch-pending" className="col-span-full text-[0.88rem] text-ink-soft">
          {view.pendingNote}
        </p>
      )}
      {view.errorNote === null ? null : (
        <p role="alert" data-slot="row-switch-error" className="col-span-full text-[0.88rem] text-ink">
          {view.errorNote}
        </p>
      )}
    </>
  );
}
