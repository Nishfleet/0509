import type { ReactElement } from "react";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import type { WhyFlagged } from "../lib/why-flagged";

const TRIGGER_CLASS =
  "text-ink-soft font-mono text-eyebrow uppercase underline underline-offset-4 min-h-11";
const CONTENT_CLASS =
  "max-h-[85dvh] overflow-y-auto sm:max-w-lg max-[859px]:top-auto max-[859px]:bottom-0 max-[859px]:left-0 max-[859px]:max-w-none max-[859px]:translate-x-0 max-[859px]:translate-y-0 max-[859px]:rounded-b-none";
const ROW_CLASS = "border-line border-b py-2";
const LABEL_CLASS = "text-ink-soft font-mono text-eyebrow uppercase";

export function WhyFlaggedSheet({ why }: { why: WhyFlagged }): ReactElement {
  return (
    <Dialog>
      <DialogTrigger render={<button type="button" />} className={TRIGGER_CLASS}>
        Why we flagged this
      </DialogTrigger>
      <DialogContent className={CONTENT_CLASS}>
        <DialogTitle className="font-display text-lg font-semibold">Why we flagged this</DialogTitle>
        <dl data-testid="why-flagged" data-verdict-id={why.verdictId} className="mt-3 font-mono">
          {why.compared.map((field) => (
            <div className={ROW_CLASS} key={field.label}>
              <dt className={LABEL_CLASS}>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
          <div className={ROW_CLASS}>
            <dt className={LABEL_CLASS}>How sure we were</dt>
            <dd>{why.sure}</dd>
          </div>
          <div className={ROW_CLASS}>
            <dt className={LABEL_CLASS}>Decision</dt>
            <dd>{why.decision}</dd>
          </div>
          <div className={ROW_CLASS}>
            <dt className={LABEL_CLASS}>Decided</dt>
            <dd>
              <time dateTime={why.decidedAt}>{why.decidedAt}</time>
            </dd>
          </div>
        </dl>
        {why.reason !== null && (
          <p data-testid="why-flagged-reason" className="mt-3 leading-[1.65] [overflow-wrap:anywhere]">
            Our read: {why.reason}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
