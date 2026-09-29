import { MCP_URL } from "../../lib/public-routes";
import { Pill } from "./pill";
import { eyebrow, Section } from "./section";

export function Agents() {
  return (
    <Section
      id="agents"
      kicker="Agent-native"
      title="Built for your agents too."
      lead="Everything you see on Home, Competitors and Alerts, your agent can read through the same API at the same moment. Agent reads are part of every plan."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border-ink bg-card min-w-0 border-[1.5px] p-6">
          <p className={`${eyebrow} text-ink-soft`}>Works with</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            <Pill label="Claude" />
            <Pill label="Cursor" />
            <Pill label="ChatGPT" />
          </ul>
          <p className="text-ink-soft mt-4 leading-[1.6]">
            Add the MCP server as a connector and sign in, or make a read-only key in Settings. Your agent reads the same
            standing, changes and alerts you do, and only your workspace.
          </p>
        </div>
        <div className="border-ink bg-card min-w-0 border-[1.5px] p-6">
          <p className={`${eyebrow} text-ink-soft`}>MCP server</p>
          <p className="font-mono mt-2 text-[0.9rem] [overflow-wrap:anywhere]">{MCP_URL}</p>
          <p className={`${eyebrow} text-ink-soft mt-6`}>Ask it</p>
          <p className="font-mono text-ink-soft mt-2 text-[0.9rem]">“Where do I stand this week, and what changed?”</p>
          <p className="mt-6">
            <a className="text-ink underline decoration-1 underline-offset-4" href="/api/v1/openapi.json">
              Read the API docs
            </a>
          </p>
        </div>
      </div>
    </Section>
  );
}
