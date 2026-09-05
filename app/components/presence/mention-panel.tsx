import { LocalTime } from "~/components/local-time";
import { formatCoverageLabel } from "~/lib/presence-display";
import type {
  MentionPanelItem,
  MentionPanelState,
  PresencePlanFeatureKey,
} from "~/lib/mention-panel-loader.server";
import type { PresenceConnectorId } from "~/lib/presence-types";

/**
 * Presentational, props-threaded Mentions panel for the presence entity page.
 * No context, no data fetching — matches the existing presence component
 * convention. The loader (`mention-panel-loader.server.ts`) owns all gating
 * and filtering; this component only renders the state it is handed.
 */
export interface MentionPanelProps {
  state: MentionPanelState;
  items: MentionPanelItem[];
  enabledConnectorIds: PresenceConnectorId[];
  pageSize: number;
  planGateFeature: PresencePlanFeatureKey | null;
}

const PLAN_GATE_COPY: Record<PresencePlanFeatureKey, string> = {
  presence_self_tracking:
    "Self-brand mention tracking isn't included in your current plan. Upgrade to start tracking your own mentions.",
  presence_competitor_tracking:
    "Competitor mention tracking isn't included in your current plan. Upgrade to start tracking competitor mentions.",
};

const HONEST_EMPTY_COPY =
  "No mentions yet — add a source to start tracking.";

export function MentionPanel({
  state,
  items,
  enabledConnectorIds,
  planGateFeature,
}: MentionPanelProps) {
  if (state === "plan-gated") {
    return (
      <article className="f9-wk-panel" aria-labelledby="mention-panel-title">
        <span className="f9-wk-kick">Mentions</span>
        <h2 id="mention-panel-title">Mentions</h2>
        <p className="f9-wk-note">
          {planGateFeature ? PLAN_GATE_COPY[planGateFeature] : HONEST_EMPTY_COPY}
        </p>
      </article>
    );
  }

  if (state === "empty-no-sources" || state === "empty-no-items") {
    return (
      <article className="f9-wk-panel" aria-labelledby="mention-panel-title">
        <span className="f9-wk-kick">Mentions</span>
        <h2 id="mention-panel-title">Mentions</h2>
        <p className="f9-wk-note">{HONEST_EMPTY_COPY}</p>
      </article>
    );
  }

  return (
    <article className="f9-wk-panel" aria-labelledby="mention-panel-title">
      <span className="f9-wk-kick">Mentions</span>
      <h2 id="mention-panel-title">Mentions</h2>
      <p className="f9-wk-dim">
        Latest {items.length} mention{items.length === 1 ? "" : "s"} across{" "}
        {enabledConnectorIds.length} source
        {enabledConnectorIds.length === 1 ? "" : "s"}.
      </p>
      <div className="f9-wk-worklist is-compact">
        {items.map((item) => (
          <div className="f9-wk-workrow" key={item.id}>
            <div>
              <h3>
                <a href={item.canonicalUrl} rel="noreferrer" target="_blank">
                  {item.title}
                </a>
              </h3>
              <p className="f9-wk-dim">
                <strong data-mention-connector={item.connectorId}>
                  {formatCoverageLabel(item.connectorId)}
                </strong>
                {" · "}
                <span data-mention-coverage={item.coverageLabel}>
                  {formatCoverageLabel(item.coverageLabel)}
                </span>
                {" · "}
                {item.publishedAt ? (
                  <LocalTime iso={item.publishedAt} />
                ) : (
                  <LocalTime iso={item.observedAt} />
                )}
              </p>
              {item.bodyExcerpt ? <p>{item.bodyExcerpt}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
