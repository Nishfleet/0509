import type { ReactElement } from "react";

import { daysAgoLabel } from "../../lib/delivery-alert";
import type { PairedSiteChange } from "../../lib/site-change";
import { CapturePlate } from "../capture-plate";
import { Mark } from "../mark";
import { Section } from "./section";

export function Marks({ marks, now }: { marks: readonly PairedSiteChange[]; now: string }): ReactElement {
  const instant = new Date(now);
  return (
    <Section
      id="mark"
      kicker="The mark"
      title="Every change, in one line."
      lead="When a brand you watch changes something, we strike the old words and put the new ones on a green marker, with the screenshot and a link to where we saw it."
    >
      {marks.length === 0 ? null : (
        <ul className="grid min-w-0 gap-8">
          {marks.map((mark, index) => (
            <li
              key={mark.id}
              className={mark.isSelf ? "bg-green-wash min-w-0 p-5" : "min-w-0"}
              data-captured-at={mark.capturedAt}
              data-own-site={mark.isSelf ? "true" : "false"}
              data-signal-id={mark.id}
            >
              <Mark
                after={mark.mark.added}
                before={mark.mark.removed}
                capture={
                  <CapturePlate
                    after={mark.after}
                    before={mark.before}
                    eager={index === 0}
                    label={mark.headline}
                  />
                }
                capturedAt={mark.capturedAt}
                size="lg"
                sourceUrl={mark.url}
              />
              <p className="font-mono text-meta text-ink-soft mt-3">{daysAgoLabel(mark.capturedAt, instant)}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
