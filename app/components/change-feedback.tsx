import type { ReactElement } from "react";

import type { ChangeFeedback as ChangeFeedbackValue } from "../lib/site-change";
import { Button } from "./ui/button";

const CHOICES: { value: ChangeFeedbackValue; label: string }[] = [
  { value: "useful", label: "Yes" },
  { value: "not_useful", label: "No" },
];

export function ChangeFeedback({
  signalId,
  feedback,
}: {
  signalId: string;
  feedback: ChangeFeedbackValue | null | undefined;
}): ReactElement {
  return (
    <form
      method="post"
      action="/app/changes/feedback"
      role="group"
      aria-label="Was this worth telling you?"
      data-testid="change-feedback"
      className="mt-3 flex flex-wrap items-center gap-x-4"
    >
      <input type="hidden" name="signalId" value={signalId} />
      <span className="font-mono text-meta text-ink-soft uppercase">
        {feedback == null ? "Was this worth telling you?" : "Thanks, noted."}
      </span>
      {CHOICES.map((choice) => (
        <Button
          key={choice.value}
          type="submit"
          name="value"
          value={choice.value}
          variant="tertiary"
          aria-pressed={feedback === choice.value}
          className={feedback === choice.value ? "decoration-2" : undefined}
        >
          {choice.label}
        </Button>
      ))}
    </form>
  );
}
