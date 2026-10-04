import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Monogram } from "./monogram";
import { Button } from "./ui/button";

export interface RetireQuestion {
  suggestionId: string;
  name: string;
  domain: string;
  reason: string | null;
}

export function RetireQuestions({ questions }: { questions: readonly RetireQuestion[] }): ReactElement | null {
  if (questions.length === 0) return null;
  return (
    <section aria-labelledby="retire-questions-heading" className="mt-12">
      <h2 id="retire-questions-heading" className={BLOCK_HEADING}>
        Still competing?
      </h2>
      <ul aria-label="Still competing?" className="mt-3 border-b border-line">
        {questions.map((question) => (
          <RetireQuestionRow key={question.suggestionId} question={question} />
        ))}
      </ul>
    </section>
  );
}

function RetireQuestionRow({ question }: { question: RetireQuestion }): ReactElement {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formData?.get("suggestionId") === question.suggestionId;
  const stopping = busy && navigation.formData?.get("intent") === "stop";
  const keeping = busy && navigation.formData?.get("intent") === "keep";
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Monogram name={question.name} off />
        <div className="min-w-0">
          <p className="truncate font-display text-row-name font-bold">{question.name}</p>
          <p className="truncate text-body-sm text-ink-soft">{question.domain}</p>
          {question.reason === null ? null : <p className="mt-1 text-body-sm text-ink-soft">{question.reason}</p>}
        </div>
      </div>
      <Form method="post" className="flex gap-2">
        <input type="hidden" name="suggestionId" value={question.suggestionId} />
        <Button
          type="submit"
          variant="secondary"
          name="intent"
          value="stop"
          aria-label={`Stop tracking ${question.name}`}
          disabled={busy}
        >
          {stopping ? "Stopping…" : "Stop tracking"}
        </Button>
        <Button
          type="submit"
          variant="tertiary"
          name="intent"
          value="keep"
          aria-label={`Keep tracking ${question.name}`}
          className="px-2"
          disabled={busy}
        >
          {keeping ? "Keeping…" : "Keep"}
        </Button>
      </Form>
    </li>
  );
}
