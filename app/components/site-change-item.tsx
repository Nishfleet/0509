import type { ReactElement } from "react";

import type { SiteChangeView } from "../lib/site-change";
import { CapturePlate } from "./capture-plate";
import { Mark } from "./mark";
import type { MarkSize } from "./mark";

export type SiteChangeItemData = SiteChangeView & { when: string };

const WHEN_CLASS = "text-ink-soft mt-2 block font-mono text-[0.75rem] tracking-[0.04em] uppercase";

function OneSided({ added, removed }: { added: string | null; removed: string | null }): ReactElement | null {
  const text = added ?? removed;
  if (text === null) return null;
  const verb = added === null ? "Removed" : "Added";
  return (
    <p className="mt-2 leading-[1.65] [overflow-wrap:anywhere]">
      {verb}: “{text}”
    </p>
  );
}

export function SiteChangeItem({
  change,
  size = "sm",
  eager = false,
}: {
  change: SiteChangeItemData;
  size?: Exclude<MarkSize, "email">;
  eager?: boolean;
}): ReactElement {
  const plate = (
    <CapturePlate label={change.headline} before={change.before} after={change.after} eager={eager} />
  );
  const removed = change.mark?.removed ?? null;
  const added = change.mark?.added ?? null;
  return (
    <article id={change.id} data-testid="site-change" className="border-line mt-8 min-w-0 border-t pt-6">
      <h3 className="font-display text-lg font-semibold [overflow-wrap:anywhere]">{change.headline}</h3>
      <div className="mt-3 flex min-w-0 flex-col gap-3">
        {removed !== null && added !== null ? (
          <Mark
            before={removed}
            after={added}
            sourceUrl={change.url}
            capturedAt={change.capturedAt}
            size={size}
            capture={plate}
          />
        ) : (
          <>
            {plate}
            <OneSided added={added} removed={removed} />
          </>
        )}
      </div>
      <p className="mt-2 leading-[1.65]">{change.sentence}</p>
      <time dateTime={change.observedAt} className={WHEN_CLASS}>
        {change.when}
      </time>
    </article>
  );
}
