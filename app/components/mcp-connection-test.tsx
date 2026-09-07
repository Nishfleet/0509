import { useId, useState } from "react";

const MCP_ENDPOINT = "https://0509.io/api/mcp";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; name: string; count: string }
  | { kind: "error"; detail: string };

/**
 * Client-only live connection test for the /mcp/setup page. The visitor
 * pastes the bearer API key they created in Developer access and we call the
 * same MCP endpoint a connector would use (POST /api/mcp, tools/list). The
 * key never leaves the browser except as the Authorization header on that
 * single request — the same path every Claude Desktop / ChatGPT / pi
 * connector uses. Server-rendered shell shows the idle form; interaction is
 * client-side only.
 */
export function McpConnectionTest() {
  const [key, setKey] = useState("");
  const [state, setState] = useState<TestState>({ kind: "idle" });
  const [resultId, setResultId] = useState("");
  const inputId = `mcp-key-${useId().replace(/:/g, "")}`;

  async function runTest() {
    const token = key.trim();
    if (!token) {
      setState({ kind: "error", detail: "Paste an API key first." });
      setResultId(inputId);
      return;
    }
    setState({ kind: "testing" });
    setResultId("");
    try {
      const res = await fetch(MCP_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        setState({
          kind: "error",
          detail: `HTTP ${res.status}${body ? ` — ${body.slice(0, 180)}` : ""}`,
        });
        setResultId(inputId);
        return;
      }
      const data = (await res.json()) as { result?: { tools?: unknown[] } };
      const tools = data.result?.tools;
      if (!Array.isArray(tools)) {
        setState({
          kind: "error",
          detail: "Connected, but the response has no usable tool list.",
        });
        setResultId(inputId);
        return;
      }
      setState({
        kind: "ok",
        name: "Connected",
        count: `${tools.length} tool${tools.length === 1 ? "" : "s"}`,
      });
      setResultId(inputId);
    } catch (err) {
      setState({
        kind: "error",
        detail: err instanceof Error ? err.message : "Network error.",
      });
      setResultId(inputId);
    }
  }

  return (
    <div className="f9-code-block">
      <p>
        Paste a customer API key, then run the test. It calls the live endpoint
        the same way a connector does.
      </p>
      <div className="f9-field">
        <span>
          <label htmlFor={inputId}>Customer API key</label>
        </span>
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          placeholder="f9_live_..."
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </div>
      <button
        className="f9-wk-btn"
        type="button"
        disabled={state.kind === "testing"}
        onClick={() => void runTest()}
      >
        {state.kind === "testing" ? "Testing…" : "Test connection"}
      </button>
      <p aria-live="polite" className="f9-sr-only" id={resultId} role="status">
        {state.kind === "ok"
          ? `${state.name}, ${state.count}.`
          : state.kind === "error"
            ? state.detail
            : ""}
      </p>
      {state.kind === "ok" && (
        <p>
          <strong>{state.name}</strong> — {state.count} available.
        </p>
      )}
      {state.kind === "error" && (
        <p>
          <strong>Not connected:</strong> {state.detail}
        </p>
      )}
    </div>
  );
}
