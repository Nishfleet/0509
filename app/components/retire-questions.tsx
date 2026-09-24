import type { ReactElement } from "react";
import { Form } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Monogram } from "./monogram";
import { Button } from "./ui/button";

import type { RetireQuestion } from "../lib/data/entity.server";

export function RetireQuestions({ questions }: { questions: readonly RetireQuestion[] }): ReactElement | null {
  if (questions.length === 0) return null;
  return (
    <section aria-labelledby="retire-questions-heading" className="mt-12">
      <h2 id="retire-questions-heading" className={BLOCK_HEADING}>
        Still competing?
      </h2>
      <ul aria-label="Still competing?" className="border-line mt-3 border-b">
        {questions.map((question) => (
          <li
            key={question.suggestionId}
            className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-t py-4"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Monogram name={question.name} off />
              <div className="min-w-0">
                <p className="font-display text-row-name truncate font-bold">{question.name}</p>
                <p className="text-ink-soft truncate text-body-sm">{question.domain}</p>
                {question.reason === null ? null : (
                  <p className="text-ink-soft mt-1 text-body-sm">{question.reason}</p>
                )}
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
              >
                Stop tracking
              </Button>
              <Button
                type="submit"
                variant="tertiary"
                name="intent"
                value="keep"
                aria-label={`Keep tracking ${question.name}`}
                className="px-2"
              >
                Keep
              </Button>
            </Form>
          </li>
        ))}
      </ul>
    </section>
  );
}
