export interface CompetitorItem {
  id: string;
  domain: string;
  name: string | null;
  state: string;
  origin: string;
}

export interface SuggestionItem {
  id: string;
  kind: string;
  candidate_domain: string;
  candidate_name: string | null;
  verdict_p: number | null;
  verdict_reason: string | null;
}

function suggestionLabel(s: SuggestionItem): string {
  if (s.candidate_domain.startsWith("name:")) {
    return s.candidate_name ?? s.candidate_domain.slice(5);
  }
  return s.candidate_domain;
}

function verdictLabel(s: SuggestionItem): string | null {
  if (s.verdict_p === null) return null;
  const tenths = `${(s.verdict_p * 10).toFixed(0)}/10`;
  return s.kind === "retire" ? `${s.verdict_reason ?? "retire?"} ${tenths}` : `${tenths} match`;
}

export function CompetitorRow({ item }: { item: CompetitorItem }) {
  const on = item.state === "on";
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="truncate font-medium">{item.name ?? item.domain}</div>
        <div className="text-body-sm text-ink-faint">
          {item.domain} · {item.origin}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <form method="post">
          <input type="hidden" name="intent" value={on ? "off" : "on"} />
          <input type="hidden" name="entity" value={item.id} />
          <button type="submit">{on ? "Turn off" : "Turn on"}</button>
        </form>
        {on ? (
          <form method="post">
            <input type="hidden" name="intent" value="dismiss-entity" />
            <input type="hidden" name="entity" value={item.id} />
            <button type="submit" className="text-red">
              Dismiss
            </button>
          </form>
        ) : null}
      </div>
    </li>
  );
}

export function SuggestionRow({ item }: { item: SuggestionItem }) {
  const verdict = verdictLabel(item);
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 truncate">
        <span className="font-medium">{suggestionLabel(item)}</span>
        {item.kind === "retire" ? <span className="text-red"> retires?</span> : null}
        {verdict ? <span className="text-ink-faint"> · {verdict}</span> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        {item.kind === "add" ? (
          <form method="post">
            <input type="hidden" name="intent" value="accept-suggestion" />
            <input type="hidden" name="suggestion" value={item.id} />
            <button type="submit">Track</button>
          </form>
        ) : null}
        <form method="post">
          <input type="hidden" name="intent" value="dismiss-suggestion" />
          <input type="hidden" name="suggestion" value={item.id} />
          <button type="submit" className="text-red">
            {item.kind === "retire" ? "Keep" : "Dismiss"}
          </button>
        </form>
      </div>
    </li>
  );
}
