import { env } from "cloudflare:workers";

import { retireReasonLine } from "../competitor/reason-customer";
import { insertCompetitorRetiredAlert } from "../data/alert.server";
import type { DiscoveryContext, RefreshTarget } from "../data/entity.server";
import { retireCompetitorByJev } from "../data/entity.server";
import { insertVerdict } from "../data/jev_verdict.server";
import { readRecentSignals, type RecentSignal } from "../data/signal.server";
import { askRetireSuggestion } from "../data/suggestion.server";
import type { ChoiceQuestion, ChoiceVerdict, NoulQuestion, NoulVerdict } from "../jev/client.server";
import { askChoice, askNoul, JevUnavailableError } from "../jev/client.server";
import { noulAction } from "../jev/thresholds";
import { daysBefore } from "../site-changes.server";

const REFRESH_WINDOW_DAYS = 30;

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

export type StillCompetitorAction = "none" | "keep" | "retire" | "ask";

export function stillCompetitorAction(result: StillCompetitorResult): StillCompetitorAction {
  const { verdict, reason, target } = result;
  if (verdict === null || reason === null) return "none";
  if (reason.choice === "dormant" || reason.choice === "pivoted") return "ask";
  if (noulAction(verdict.p) === "act") return "keep";
  if (
    noulAction(verdict.p) === "reject" &&
    (reason.choice === "acquired" || reason.choice === "shut_down") &&
    target.origin === "auto"
  ) {
    return "retire";
  }
  return "ask";
}

function statementsForStillCompetitor(
  workspaceId: string,
  result: StillCompetitorResult,
  action: Exclude<StillCompetitorAction, "none">,
  now: string,
): D1PreparedStatement[] {
  const { target, verdict, reason } = result;
  if (verdict === null || reason === null) return [];
  const line = retireReasonLine(reason.choice);
  const verdicts = [
    ...(verdict.cached
      ? []
      : [
          insertVerdict({
            workspaceId,
            questionId: verdict.questionId,
            inputHash: verdict.inputHash,
            signalId: null,
            entityId: target.entityId,
            p: verdict.p,
            choice: null,
            reason: null,
            decidedAt: now,
          }),
        ]),
    ...(reason.cached
      ? []
      : [
          insertVerdict({
            workspaceId,
            questionId: reason.questionId,
            inputHash: reason.inputHash,
            signalId: null,
            entityId: target.entityId,
            p: null,
            choice: reason.choice,
            reason: null,
            decidedAt: now,
          }),
        ]),
  ];
  if (action === "retire") {
    return [
      ...verdicts,
      retireCompetitorByJev({
        workspaceId,
        entityId: target.entityId,
        reason: reason.choice,
        now,
      }),
      insertCompetitorRetiredAlert(env.DB, {
        workspaceId,
        entityId: target.entityId,
        name: target.name,
        line,
        now,
      }),
    ];
  }
  if (action === "ask") {
    return [
      ...verdicts,
      askRetireSuggestion({
        workspaceId,
        entityId: target.entityId,
        domain: target.domain,
        name: target.name,
        p: verdict.p,
        line,
        now,
      }),
    ];
  }
  return verdicts;
}

export async function writeStillCompetitorResults(
  workspaceId: string,
  results: readonly StillCompetitorResult[],
  now: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const result of results) {
    const action = stillCompetitorAction(result);
    if (action === "none") continue;
    statements.push(...statementsForStillCompetitor(workspaceId, result, action, now));
  }
  if (statements.length === 0) return;
  await env.DB.batch(statements);
}

export async function judgeStillCompetitors(
  context: DiscoveryContext,
  targets: readonly RefreshTarget[],
  now: string,
): Promise<StillCompetitorResult[]> {
  const since = daysBefore(new Date(now), REFRESH_WINDOW_DAYS);
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
