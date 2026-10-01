import { MCP_URL } from "../../lib/public-routes";
import { Pill } from "./pill";
import { eyebrow, Section } from "./section";

export function Agents() {
  return (
    <Section
      id="agents"
      kicker="For AI agents"
      title="Built for your agents too."
      lead="Everything you see on Home, Competitors and Alerts, your AI agent can read too, at the same moment. Reading is part of every plan."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 border-[1.5px] border-ink bg-card p-6">
          <p className={`${eyebrow} text-ink-soft`}>Works with</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            <Pill label="Claude" />
            <Pill label="Cursor" />
            <Pill label="ChatGPT" />
          </ul>
          <p className="mt-4 leading-[1.6] text-ink-soft">
            Add the MCP server (the link on the right) as a connector and sign in, or make a read-only key in Settings.
            Your agent reads the same ranking, changes and alerts you do, and only your own account.
          </p>
        </div>
        <div className="min-w-0 border-[1.5px] border-ink bg-card p-6">
          <p className={`${eyebrow} text-ink-soft`}>MCP server</p>
          <p className="mt-2 font-mono text-[0.9rem] [overflow-wrap:anywhere]">{MCP_URL}</p>
          <p className={`${eyebrow} mt-6 text-ink-soft`}>Try asking</p>
          <p className="mt-2 font-mono text-[0.9rem] text-ink-soft">“Where do I stand this week, and what changed?”</p>
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
