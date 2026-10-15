import { useFetcher } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";

function Kind({ name, label, on }: { name: string; label: string; on: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-3 leading-[1.55]">
      <input type="checkbox" name={name} value="yes" defaultChecked={on} className="size-5 shrink-0 accent-green" />
      {label}
    </label>
  );
}

export function MailKinds({ address, mail }: { address: string; mail: { brief: boolean; alerts: boolean } }) {
  const fetcher = useFetcher<{ saved: boolean | null; deliveryError: string | null }>();
  const saving = fetcher.state !== "idle";
  return (
    <section aria-labelledby="mail-kinds" className="mt-10 border-t border-line pt-6">
      <h2 id="mail-kinds" className={BLOCK_HEADING}>
        Emails to this address
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55] [overflow-wrap:anywhere]">
        Choose what reaches <strong className="font-semibold">{address}</strong>. Sign-in links always arrive.
      </p>
      <fetcher.Form method="post" action="/app/settings" className="mt-4 flex flex-col gap-1">
        <input type="hidden" name="intent" value="mail-kinds" />
        <Kind name="brief" label="The weekly brief" on={mail.brief} />
        <Kind name="alerts" label="Alerts, when a competitor changes or your site has trouble" on={mail.alerts} />
        <Button type="submit" variant="secondary" size="lg" className="mt-2 self-start" disabled={saving}>
          {saving ? "Updating…" : "Update choices"}
        </Button>
        <p role="status" className="mt-2 max-w-prose leading-[1.55]">
          {fetcher.state === "idle" && fetcher.data?.saved === true ? "Email choices saved." : null}
        </p>
        {fetcher.data?.deliveryError ? (
          <p role="alert" className="mt-2 max-w-prose leading-[1.55]">
            {fetcher.data.deliveryError}
          </p>
        ) : null}
      </fetcher.Form>
    </section>
  );
}
