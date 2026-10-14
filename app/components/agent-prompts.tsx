import { useState } from "react";
import type { ReactElement } from "react";

import { AGENT_PROMPTS } from "../lib/agent/prompts";
import type { AgentPrompt } from "../lib/agent/prompts";
import { copyToClipboard } from "../lib/copy-to-clipboard";
import { CopyFailureNote } from "./agent-settings";
import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";

const BLOCK = "mt-10 border-t border-line pt-4";

function PromptRow({ prompt }: { prompt: AgentPrompt }): ReactElement {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <li
      data-testid="agent-prompt"
      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-line py-3"
    >
      <p className="max-w-prose min-w-0">
        <span className="font-display font-bold">{prompt.title}</span>
        <span className="block leading-[1.55] text-ink-soft">{prompt.text}</span>
      </p>
      <Button
        type="button"
        variant="tertiary"
        aria-label={`Copy prompt: ${prompt.title}`}
        onClick={() => {
          void copyToClipboard(prompt.text).then(setState);
        }}
      >
        {state === "copied" ? "Copied" : "Copy"}
      </Button>
      {state === "failed" ? <CopyFailureNote subject="prompt above" /> : null}
    </li>
  );
}

export function AgentPrompts(): ReactElement {
  return (
    <section aria-labelledby="agents-prompts" className={BLOCK}>
      <h2 id="agents-prompts" className={BLOCK_HEADING}>
        Try asking
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        Once an app is connected, paste one of these to it. It reads your account and answers.
      </p>
      <ul className="mt-3 border-b border-line">
        {AGENT_PROMPTS.map((prompt) => (
          <PromptRow key={prompt.title} prompt={prompt} />
        ))}
      </ul>
    </section>
  );
}
