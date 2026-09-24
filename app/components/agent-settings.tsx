import type { AgentKey, ConnectedApp } from "../lib/agent/access";

function day(iso: string): string {
  return iso.slice(0, 10);
}

export function ConnectDetails({ mcpUrl, origin }: { mcpUrl: string; origin: string }) {
  return (
    <section aria-labelledby="agents-connect">
      <h2 id="agents-connect">Connect an AI app</h2>
      <p>Add this address as a connector in Claude, ChatGPT or Cursor. You'll be asked to sign in and say yes.</p>
      <p>
        <code>{mcpUrl}</code>
      </p>
      <p>
        Writing your own code? Make a key below and read the <a href={`${origin}/api/v1/openapi.json`}>API reference</a>.
      </p>
    </section>
  );
}

export function ConnectedApps({ apps }: { apps: ConnectedApp[] }) {
  return (
    <section aria-labelledby="agents-apps">
      <h2 id="agents-apps">Connected apps</h2>
      {apps.length === 0 ? <p>No apps are connected.</p> : null}
      <ul>
        {apps.map((app) => (
          <li key={app.grantId} data-testid="connected-app">
            {app.name}, connected {day(app.connectedAt)}
            <form method="post">
              <input type="hidden" name="intent" value="disconnect-app" />
              <input type="hidden" name="id" value={app.grantId} />
              <button type="submit">Disconnect</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AgentKeys({ keys, newKey }: { keys: AgentKey[]; newKey: string | null }) {
  return (
    <section aria-labelledby="agents-keys">
      <h2 id="agents-keys">API keys</h2>
      {newKey === null ? null : (
        <div role="status">
          <p>Copy your new key now. For your safety it won't be shown again.</p>
          <p>
            <code data-testid="new-api-key">{newKey}</code>
          </p>
          <button type="button" onClick={() => void navigator.clipboard.writeText(newKey)}>
            Copy key
          </button>
        </div>
      )}
      {keys.length === 0 ? <p>You have no keys.</p> : null}
      <ul>
        {keys.map((key) => (
          <li key={key.id} data-testid="api-key">
            {key.name} ({key.start ?? "key"}…), made {day(key.createdAt)},{" "}
            {key.lastUsedAt === null ? "never used" : `last used ${day(key.lastUsedAt)}`}
            <form method="post">
              <input type="hidden" name="intent" value="revoke-key" />
              <input type="hidden" name="id" value={key.id} />
              <button type="submit">Delete</button>
            </form>
          </li>
        ))}
      </ul>
      <form method="post">
        <input type="hidden" name="intent" value="create-key" />
        <label>
          Name <input name="name" maxLength={60} placeholder="My agent" />
        </label>
        <button type="submit">Make a key</button>
      </form>
    </section>
  );
}
