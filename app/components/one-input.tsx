import type { ReactNode } from "react";

import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function OneInput({
  label,
  placeholder,
  name,
  action,
  method = "post",
  message,
  submitLabel,
  required = false,
  maxLength,
}: {
  label: string;
  placeholder: string;
  name: string;
  action: string;
  method?: "get" | "post";
  message?: string | undefined;
  submitLabel: ReactNode;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <form method={method} action={action} className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          name={name}
          placeholder={placeholder}
          aria-label={label}
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          required={required}
          maxLength={maxLength}
          className="sm:flex-1"
        />
        <Button type="submit" size="lg">
          {submitLabel}
        </Button>
      </div>
      {message ? (
        <p role="status" className="mt-3 text-[0.95rem]">
          {message}
        </p>
      ) : null}
    </form>
  );
}
