import { useState } from "react";
import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

import type { AgentKey, ConnectedApp } from "../lib/agent/access";
import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const BLOCK = "mt-10 border-t border-line pt-4";
const ROW = "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3";
const CLIENTS = ["Claude", "ChatGPT", "Cursor"];

function day(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "date unknown" : DAY.format(new Date(ms));
}

export const COPY_DEADLINE_MS = 2_000;

export function copyToClipboard(value: string, deadlineMs = COPY_DEADLINE_MS): Promise<"copied" | "failed"> {
  const write = Promise.resolve()
    .then(() => navigator.clipboard.writeText(value))
    .then(
      () => "copied" as const,
      () => "failed" as const,
    );
  return Promise.race([
    write,
    new Promise<"copied" | "failed">((settle) => {
      setTimeout(() => {
        settle("failed");
      }, deadlineMs);
    }),
  ]);
}

export function copyKeyLabel(state: "idle" | "copied" | "failed"): string {
  return state === "copied" ? "Copied" : "Copy key";
}

export function CopyFailureNote({ subject }: { subject: string }): ReactElement {
  return (
    <p role="status" className="mt-2 text-body-sm text-ink-soft">
      Copy failed. Select the {subject} and copy it by hand.
    </p>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <Input
        readOnly
        value={value}
        aria-label={label}
        className="font-mono text-[0.9rem] sm:flex-1"
        onFocus={(event) => {
          event.currentTarget.select();
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="lg"
        onClick={() => {
          void copyToClipboard(value).then(setState);
        }}
      >
        {state === "copied" ? "Copied" : "Copy"}
      </Button>
      {state === "failed" ? <CopyFailureNote subject={label.toLowerCase()} /> : null}
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
          <li key={client} data-testid="agent-client" className="border border-line px-2 py-0.5 font-mono text-meta">
            {client}
          </li>
        ))}
      </ul>
      <CopyField label="Connector address" value={mcpUrl} />
      <p className="mt-3 text-body-sm text-ink-soft">Connecting with a key instead? Send it in this header.</p>
      <CopyField label="Authorization header" value="Authorization: Bearer <your key>" />
      <p className="mt-3 text-body-sm text-ink-soft">
        Writing your own code? Make a key below and read the{" "}
        <a className="text-ink underline decoration-1 underline-offset-4" href={`${origin}/api/docs`}>
          API reference
        </a>
        .
      </p>
    </section>
  );
}

function DisconnectButton({ app }: { app: ConnectedApp }) {
  const navigation = useNavigation();
  const leaving =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "disconnect-app" &&
    navigation.formData?.get("id") === app.grantId;
  return (
    <Button type="submit" variant="tertiary" aria-label={`Disconnect ${app.name}`} disabled={leaving}>
      {leaving ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}

export function ConnectedApps({ apps }: { apps: ConnectedApp[] }) {
  return (
    <section aria-labelledby="agents-apps" className={BLOCK}>
      <h2 id="agents-apps" className={BLOCK_HEADING}>
        Connected apps
      </h2>
      {apps.length === 0 ? (
        <p className="mt-2 leading-[1.55] text-ink-soft">
          None yet. Apps you connect show here, and you can disconnect them any time.
        </p>
      ) : (
        <ul className="mt-3 border-b border-line">
          {apps.map((app) => (
            <li key={app.grantId} data-testid="connected-app" className={ROW}>
              <p className="min-w-0">
                <span className="font-display font-bold">{app.name}</span>
                <span className="block text-body-sm text-ink-soft">Connected {day(app.connectedAt)}</span>
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="disconnect-app" />
                <input type="hidden" name="id" value={app.grantId} />
                <DisconnectButton app={app} />
              </Form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function keyDetail(key: AgentKey): string {
  return [
    `Created ${day(key.createdAt)}`,
    key.lastUsedAt === null ? "never used" : `last used ${day(key.lastUsedAt)}`,
    ...(key.rateLimitMax === null ? [] : [`up to ${String(key.rateLimitMax)} requests a minute`]),
    ...(key.remaining === null ? [] : [`${String(key.remaining)} requests left`]),
  ].join(" · ");
}

function NewKeyNotice({ newKey }: { newKey: string }) {
  return (
    <div role="status" className="mt-3 border-[1.5px] border-ink bg-green-wash p-4">
      <p className="font-semibold text-green-ink">Copy your new key now. For your safety it won't be shown again.</p>
      <code data-testid="new-api-key" className="mt-2 block font-mono text-[0.9rem] [overflow-wrap:anywhere]">
        {newKey}
      </code>
      <CopyKey value={newKey} />
    </div>
  );
}

function DuplicateKeyNotice() {
  return (
    <p role="status" className="mt-3 border-[1.5px] border-ink p-4 leading-[1.55]">
      That key was already created. Its secret is only shown once; delete it and make a new one if you didn't copy it.
    </p>
  );
}

function KeyRow({ apiKey }: { apiKey: AgentKey }) {
  const navigation = useNavigation();
  const deleting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "revoke-key" &&
    navigation.formData.get("id") === apiKey.id;
  return (
    <li data-testid="api-key" className={ROW}>
      <p className="min-w-0">
        <span className="font-display font-bold">{apiKey.name}</span>{" "}
        <span className="font-mono text-meta text-ink-soft">{apiKey.start ?? "key"}…</span>
        <span className="block text-body-sm text-ink-soft">{keyDetail(apiKey)}</span>
      </p>
      <Form method="post">
        <input type="hidden" name="intent" value="revoke-key" />
        <input type="hidden" name="id" value={apiKey.id} />
        <Button
          type="submit"
          variant="tertiary"
          aria-label={deleting ? `Deleting ${apiKey.name}` : `Delete ${apiKey.name}`}
          disabled={deleting}
        >
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      </Form>
    </li>
  );
}

function CreateKeyForm({ submission }: { submission: string }) {
  const navigation = useNavigation();
  const making = navigation.state !== "idle" && navigation.formData?.get("intent") === "create-key";
  return (
    <Form method="post" className="mt-6">
      <input type="hidden" name="intent" value="create-key" />
      <input type="hidden" name="submission" value={submission} />
      <label htmlFor="key-name" className={BLOCK_HEADING}>
        Name
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id="key-name"
          name="name"
          maxLength={60}
          placeholder="My agent"
          autoComplete="off"
          className="sm:flex-1"
        />
        <Button type="submit" variant="secondary" size="lg" disabled={making}>
          {making ? "Making…" : "Make a key"}
        </Button>
      </div>
    </Form>
  );
}

export function AgentKeys({
  keys,
  newKey,
  duplicate,
  submission,
}: {
  keys: AgentKey[];
  newKey: string | null;
  duplicate: boolean;
  submission: string;
}) {
  return (
    <section aria-labelledby="agents-keys" className={BLOCK}>
      <h2 id="agents-keys" className={BLOCK_HEADING}>
        API keys
      </h2>
      {newKey === null ? null : <NewKeyNotice newKey={newKey} />}
      {duplicate ? <DuplicateKeyNotice /> : null}
      {keys.length === 0 ? (
        <p className="mt-2 leading-[1.55] text-ink-soft">
          No keys yet. A key lets your own code read the same things an app can.
        </p>
      ) : (
        <ul className="mt-3 border-b border-line">
          {keys.map((key) => (
            <KeyRow key={key.id} apiKey={key} />
          ))}
        </ul>
      )}
      <CreateKeyForm submission={submission} />
    </section>
  );
}

export function CopyKey({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          void copyToClipboard(value).then(setState);
        }}
      >
        {copyKeyLabel(state)}
      </Button>
      {state === "failed" ? <CopyFailureNote subject="key above" /> : null}
    </div>
  );
}
