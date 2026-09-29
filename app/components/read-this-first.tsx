import { Fragment, type ReactElement } from "react";

import { Mark } from "./mark";
import type { BriefPayload } from "../lib/brief-payload";
import { httpUrl } from "../lib/http-url";
import { UNJUDGED_WEEK_LINE } from "../lib/read-this-first";

const SECTION = "mt-5 border-t border-line pt-4";
const HEAD = "font-mono text-eyebrow text-ink-soft uppercase";
const BODY = "mt-2 text-[0.95rem] leading-[1.6]";

const MAX_MARKS = 3;

function markBlock(mark: BriefPayload["read_this_first"][number]): ReactElement {
  const href = httpUrl(mark.url);
  const title =
    mark.before === null || mark.after === null ? (
      href === null ? (
        <p className={BODY}>{mark.title}</p>
      ) : (
        <p className={BODY}>
          <a className="underline decoration-1 underline-offset-4" href={href}>
            {mark.title}
          </a>
        </p>
      )
    ) : (
      <Mark
        before={mark.before}
        after={mark.after}
        sourceUrl={mark.url}
        capturedAt={mark.observed_at}
        size="md"
      />
    );
  return (
    <Fragment key={mark.signal_id}>
      {title}
      <p className="mt-2 text-[0.88rem] leading-[1.6] text-ink-soft">
        {mark.entity_name}: {mark.jev_reason}
      </p>
    </Fragment>
  );
}

export function ReadThisFirst({
  marks,
  unjudged = false,
  headingLevel = 3,
}: {
  marks: BriefPayload["read_this_first"];
  unjudged?: boolean;
  headingLevel?: 2 | 3;
}): ReactElement {
  const HeadingTag = headingLevel === 2 ? "h2" : "h3";
  return (
    <section data-brief-block="read-this-first" className={SECTION}>
      <HeadingTag className={HEAD}>Read this first</HeadingTag>
      {unjudged ? (
        <p className={BODY}>{UNJUDGED_WEEK_LINE}</p>
      ) : marks.length === 0 ? (
        <p className={BODY}>Nothing this week needed reading first.</p>
      ) : (
        marks.slice(0, MAX_MARKS).map(markBlock)
      )}
    </section>
  );
}
