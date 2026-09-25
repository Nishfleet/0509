import { Form } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function CompetitorForget({ name, error }: { name: string; error: string | null }) {
  return (
    <section aria-labelledby="forget-competitor" className="border-line border-t pt-4">
      <h2 id="forget-competitor" className={BLOCK_HEADING}>
        Remove and forget
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        We stop tracking {name} and delete every change and screenshot we kept. Turning it off keeps its history;
        this does not. This can't be undone.
      </p>
      <Form method="post" className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="intent" value="forget" />
        <label htmlFor="confirm-name" className="leading-[1.55] [overflow-wrap:anywhere]">
          Type {name} to confirm
        </label>
        <Input
          id="confirm-name"
          name="confirm"
          type="text"
          autoComplete="off"
          required
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : "forget-competitor-error"}
        />
        {error === null ? null : (
          <p id="forget-competitor-error" role="alert" className="text-[0.95rem]">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" size="lg" className="border-red self-start">
          Remove and forget {name}
        </Button>
      </Form>
    </section>
  );
}
