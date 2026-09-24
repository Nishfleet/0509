import type { ReactElement } from "react";

import type { LandingMark } from "../../lib/landing-marks";
import { CapturePlate } from "../capture-plate";
import { Mark } from "../mark";
import { Section } from "./section";

export function Marks({ marks }: { marks: readonly LandingMark[] }): ReactElement {
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
              className={mark.ownSite ? "bg-green-wash min-w-0 p-5" : "min-w-0"}
              data-captured-at={mark.capturedAt}
              data-own-site={mark.ownSite ? "true" : "false"}
              data-signal-id={mark.id}
            >
              <Mark
                after={mark.after}
                before={mark.before}
                capture={
                  <CapturePlate
                    after={mark.afterShot}
                    before={mark.beforeShot}
                    eager={index === 0}
                    label={mark.headline}
                  />
                }
                capturedAt={mark.capturedAt}
                size="lg"
                sourceUrl={mark.sourceUrl}
              />
              <p className="font-mono text-meta text-ink-soft mt-3">{mark.age}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
