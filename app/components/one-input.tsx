import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Form } from "react-router";

export interface OneInputProps {
  label: string;
  action: string;
  notFound?: boolean;
  defaultValue?: string;
  /**
   * Changes once per not-found submit. The route's action returns a fresh
   * `{ notFound: true }` object every time, so this is where "the input stays
   * focused" gets its re-run on a repeat submit — a boolean alone cannot tell
   * a second submit from the first.
   */
  notFoundKey?: number;
}

const NOT_FOUND_LINE = "we couldn't find anything for that, try the main website";

export function OneInput({
  label,
  action,
  notFound = false,
  defaultValue,
  notFoundKey = 0,
}: OneInputProps): ReactElement {
  const field = useRef<HTMLInputElement>(null);

  // Refocus whenever the not-found line is showing. Keyed on `actionData`'s
  // identity (and on `notFound`), not on `notFound` alone: a second whitespace
  // submit leaves the boolean true and would otherwise skip the effect, while
  // the route's action returns a fresh object every submit.
  useEffect(() => {
    if (notFound) field.current?.focus();
  }, [notFound, notFoundKey]);

  return (
    <div className="flex w-full flex-col gap-3">
      <Form
        method="post"
        action={action}
        className="flex w-full flex-col gap-3 sm:flex-row sm:items-start"
      >
        <input
          ref={field}
          name="subject"
          type="text"
          aria-label={label}
          placeholder={label}
          defaultValue={defaultValue}
          required
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          autoFocus
          className="w-full border border-line bg-card px-4 py-3 font-sans text-base text-ink outline-none placeholder:text-ink-faint focus-visible:border-accent sm:max-w-[26rem]"
        />
        <button
          type="submit"
          className="shrink-0 border border-ink bg-accent px-5 py-3 font-display text-[0.95rem] font-bold uppercase tracking-[0.02em] text-on-accent"
        >
          Continue
        </button>
      </Form>
      {notFound ? (
        <p role="status" className="font-mono text-[0.72rem] leading-[1.4] text-ink-soft">
          {NOT_FOUND_LINE}
        </p>
      ) : null}
    </div>
  );
}
