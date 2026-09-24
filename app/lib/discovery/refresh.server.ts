import type { DiscoveryContext, RefreshTarget } from "../data/entity.server";
import { readRecentSignals, type RecentSignal } from "../data/signal.server";
import type { ChoiceQuestion, ChoiceVerdict, NoulQuestion, NoulVerdict } from "../jev/client.server";
import { askChoice, askNoul, JevUnavailableError } from "../jev/client.server";

const DAY_MS = 86_400_000;

export const STILL_COMPETITOR: NoulQuestion = {
  id: "still_competitor",
  instructions:
    "Given `history_30d`, the last 30 days of what we saw from `subject`, is `subject` still a live competitor of `self`: still trading, still selling a substitute to the same kind of customer?",
  whenTrue: "It is still trading and still sells a substitute to the same kind of customer as `self`.",
  whenFalse:
    "It was acquired, shut down, stopped trading, or now sells something the customers of `self` would not buy instead.",
};

export const STILL_COMPETITOR_REASON: ChoiceQuestion = {
  id: "still_competitor_reason",
  instructions: "Which best describes `subject` over the last 30 days, judged from `history_30d`?",
  options: {
    active: "still trading and competing with `self`",
    acquired: "bought by another company or merged into one",
    shut_down: "closed, stopped trading, or its site is gone",
    pivoted: "still trading but now sells something different",
    dormant: "still exists but has gone quiet: no launches, posts or changes",
  },
};

function stillCompetitorState(
  context: DiscoveryContext,
  target: RefreshTarget,
  history: readonly RecentSignal[],
): unknown {
  return {
    self: {
      name: context.self.name,
      domain: context.self.domain,
      description: context.self.description,
    },
    competitor_set: context.competitors,
    subject: { name: target.name, domain: target.domain },
    history_30d: history,
    user_memory: { dismissed_domains: context.dismissedDomains },
  };
}

export interface StillCompetitorResult {
  target: RefreshTarget;
  verdict: NoulVerdict | null;
  reason: ChoiceVerdict | null;
}

export async function judgeStillCompetitors(
  context: DiscoveryContext,
  targets: readonly RefreshTarget[],
  now: string,
): Promise<StillCompetitorResult[]> {
  const since = new Date(Date.parse(now) - 30 * DAY_MS).toISOString();
  const results: StillCompetitorResult[] = [];
  let available = true;
  for (const target of targets) {
    const history = await readRecentSignals(target.entityId, since);
    let verdict: NoulVerdict | null = null;
    let reason: ChoiceVerdict | null = null;
    if (available) {
      const state = stillCompetitorState(context, target, history);
      try {
        [verdict, reason] = await Promise.all([
          askNoul(context.self.workspaceId, STILL_COMPETITOR, state),
          askChoice(context.self.workspaceId, STILL_COMPETITOR_REASON, state),
        ]);
      } catch (error) {
        if (!(error instanceof JevUnavailableError)) throw error;
        console.error(JSON.stringify({ event: "refresh.jev_unavailable", message: error.message }));
        available = false;
      }
    }
    results.push({ target, verdict, reason });
  }
  return results;
}
