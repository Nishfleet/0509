import { useState } from "react";
import type { ReactElement } from "react";

import { rivalOnePager, type OnePagerInput } from "../lib/rival-one-pager";
import { Button } from "./ui/button";

type CopyState = "idle" | "copied" | "failed";

export function RivalOnePager(props: OnePagerInput): ReactElement {
  const [state, setState] = useState<CopyState>("idle");
  const text = rivalOnePager(props);

  async function copy() {
    const written = await Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => true,
        () => false,
      );
    setState(written ? "copied" : "failed");
  }

  return (
    <section data-slot="rival-one-pager" aria-label="One-pager" className="flex min-w-0 flex-col gap-3">
      <div>
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          Copy as a one-pager
        </Button>
      </div>
      {state === "copied" ? <p role="status">Copied. Paste it into Slack, Notion or an email.</p> : null}
      {state === "failed" ? (
        <>
          <p role="status">Your browser would not let us copy. Select the text below instead.</p>
          <textarea readOnly rows={10} value={text} aria-label="One-pager text" className="border border-line p-3" />
        </>
      ) : null}
    </section>
  );
}
