import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

export interface OneInputProps {
  label: string;
  action: string;
  notFound?: boolean;
  defaultValue?: string;
}

const NOT_FOUND_LINE = "we couldn't find anything for that, try the main website";

export function OneInput({
  label,
  action,
  notFound = false,
  defaultValue,
}: OneInputProps): ReactElement {
  const field = useRef<HTMLInputElement>(null);
  const navigation = useNavigation();

  useEffect(() => {
    if (notFound && navigation.state === "idle") field.current?.focus();
  }, [notFound, navigation.state]);

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
