import { useState } from "react";
import { Form } from "react-router";

import type { AgentKey, ConnectedApp } from "../lib/agent/access";
import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const BLOCK = "border-line mt-10 border-t pt-4";
const ROW = "border-line flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t py-3";
const CLIENTS = ["Claude", "ChatGPT", "Cursor"];

function day(iso: string): string {
  return DAY.format(new Date(iso));
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <Input readOnly value={value} aria-label={label} className="font-mono text-[0.9rem] sm:flex-1" onFocus={(event) => {
          event.currentTarget.select();
        }} />
      <Button
        type="button"
        variant="secondary"
        size="lg"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function ConnectDetails({ mcpUrl, origin }: { mcpUrl: string; origin: string }) {
  return (
    <section aria-labelledby="agents-connect" className={BLOCK}>
      <h2 id="agents-connect" className={BLOCK_HEADING}>
        Connect an AI app
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        Add this address as a connector in Claude, ChatGPT or Cursor. You'll be asked to sign in and say yes.
      </p>
      <ul aria-label="Works with" className="mt-3 flex flex-wrap gap-2">
        {CLIENTS.map((client) => (
          <li key={client} data-testid="agent-client" className="border-line border px-2 py-0.5 font-mono text-meta">
            {client}
          </li>
        ))}
      </ul>
      <CopyField label="Connector address" value={mcpUrl} />
      <p className="text-ink-soft mt-3 text-body-sm">Connecting with a key instead? Send it in this header.</p>
      <CopyField label="Header" value="Authorization: Bearer <your key>" />
      <p className="text-ink-soft mt-3 text-body-sm">
        Writing your own code? Make a key below and read the{" "}
        <a className="text-ink underline decoration-1 underline-offset-4" href={`${origin}/api/v1/openapi.json`}>
          API reference
        </a>
        .
      </p>
    </section>
  );
}

export function ConnectedApps({ apps }: { apps: ConnectedApp[] }) {
  return (
    <section aria-labelledby="agents-apps" className={BLOCK}>
      <h2 id="agents-apps" className={BLOCK_HEADING}>
        Connected apps
      </h2>
      {apps.length === 0 ? (
        <p className="text-ink-soft mt-2 leading-[1.55]">None yet. Apps you connect show here, and you can disconnect them any time.</p>
      ) : (
        <ul className="border-line mt-3 border-b">
          {apps.map((app) => (
            <li key={app.grantId} data-testid="connected-app" className={ROW}>
              <p className="min-w-0">
                <span className="font-display font-bold">{app.name}</span>
                <span className="text-ink-soft block text-body-sm">Connected {day(app.connectedAt)}</span>
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="disconnect-app" />
                <input type="hidden" name="id" value={app.grantId} />
                <Button type="submit" variant="tertiary" aria-label={`Disconnect ${app.name}`}>
                  Disconnect
                </Button>
              </Form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AgentKeys({ keys, newKey }: { keys: AgentKey[]; newKey: string | null }) {
  return (
    <section aria-labelledby="agents-keys" className={BLOCK}>
      <h2 id="agents-keys" className={BLOCK_HEADING}>
        API keys
      </h2>
      {newKey === null ? null : (
        <div role="status" className="border-ink bg-green-wash mt-3 border-[1.5px] p-4">
          <p className="text-green-ink font-semibold">Copy your new key now. For your safety it won't be shown again.</p>
          <code data-testid="new-api-key" className="mt-2 block font-mono text-[0.9rem] [overflow-wrap:anywhere]">
            {newKey}
          </code>
          <CopyKey value={newKey} />
        </div>
      )}
      {keys.length === 0 ? (
        <p className="text-ink-soft mt-2 leading-[1.55]">No keys yet. A key lets your own code read the same things an app can.</p>
      ) : (
        <ul className="border-line mt-3 border-b">
          {keys.map((key) => (
            <li key={key.id} data-testid="api-key" className={ROW}>
              <p className="min-w-0">
                <span className="font-display font-bold">{key.name}</span>{" "}
                <span className="text-ink-soft font-mono text-meta">{key.start ?? "key"}…</span>
                <span className="text-ink-soft block text-body-sm">
                  Made {day(key.createdAt)} · {key.lastUsedAt === null ? "never used" : `last used ${day(key.lastUsedAt)}`}
                </span>
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="revoke-key" />
                <input type="hidden" name="id" value={key.id} />
                <Button type="submit" variant="tertiary">
                  Delete
                </Button>
              </Form>
            </li>
          ))}
        </ul>
      )}
      <Form method="post" className="mt-6">
        <input type="hidden" name="intent" value="create-key" />
        <label htmlFor="key-name" className={BLOCK_HEADING}>
          Name
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input id="key-name" name="name" maxLength={60} placeholder="My agent" className="sm:flex-1" />
          <Button type="submit" variant="secondary" size="lg">
            Make a key
          </Button>
        </div>
      </Form>
    </section>
  );
}

function CopyKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="mt-3"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
        });
      }}
    >
      {copied ? "Copied" : "Copy key"}
    </Button>
  );
}
