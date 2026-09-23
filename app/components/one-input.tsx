import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

export interface OneInputProps {
  label: string;
  action: string;
}

export function OneInput({ label, action }: OneInputProps): ReactElement {
  const field = useRef<HTMLInputElement>(null);
  const navigation = useNavigation();
  const submitted = useRef(false);

  useEffect(() => {
    if (navigation.state !== "idle") {
      submitted.current = true;
      return;
    }
    if (submitted.current) {
      submitted.current = false;
      field.current?.focus();
    }
  }, [navigation.state]);

  return (
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
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="go"
        autoFocus
        className="w-full border border-line bg-card px-4 py-3 font-sans text-body text-ink outline-none placeholder:text-ink-faint focus-visible:border-green sm:max-w-[26rem]"
      />
      <button
        type="submit"
        className="shrink-0 border border-ink bg-green px-5 py-3 font-display text-[0.95rem] font-bold uppercase tracking-[0.02em] text-on-green"
      >
        Continue
      </button>
    </Form>
  );
}
