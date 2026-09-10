/**
 * The per-competitor delivery settings card used to carry nine form fields —
 * a sensitivity select, a free-text timezone, raw quiet-hours number inputs and
 * five channel checkboxes — on tab 4 of 5 of every competitor. All of them had a
 * correct default that nobody needed to change, and the quiet-hours pair in
 * particular was a trap: an untouched form silently switched on 22:00-08:00
 * (issue #2263).
 *
 * The card now renders zero form fields. Delivery is: sensitivity auto, quiet
 * hours 22:00-08:00 in the timezone captured once from the browser, digest and
 * email on. `resolveDeliveryConfig` owns those values, so nothing here needs to
 * collect or send them. What stays per-competitor is switching a target off and
 * on again, which lives in `delivery-targets-section.tsx` and is untouched.
 */
import type { WatchlistDeliveryConfigRecord } from "~/lib/types";

export function DeliverySettingsCard(props: {
  data: {
    plan: string;
    watchlistDeliveryConfig: WatchlistDeliveryConfigRecord | null;
  };
  canConfigureDigestSettings: boolean;
}) {
  const { data, canConfigureDigestSettings } = props;
  return (
    <article className="f9-detail-cell">
      <p className="f9-wk-kick">Delivery settings</p>
      <h3>Channel policy</h3>
      {canConfigureDigestSettings ? (
        <div className="f9-wk-worklist is-compact">
          <p className="f9-wk-dim">
            Alerts use your account defaults: high-priority alerts and the digest
            go out together, quiet hours run 22:00-08:00 in your local time, and
            every competitor is watched until you pause it.
          </p>
          <p className="f9-wk-dim">
            To stop alerts for one competitor, pause it under Targets and pauses.
          </p>
        </div>
      ) : (
        <div className="f9-wk-worklist is-compact">
          <p className="f9-wk-dim">
            Delivery settings are managed by the workspace owner.
          </p>
        </div>
      )}
      {data.watchlistDeliveryConfig ? null : (
        <p className="f9-wk-dim">
          Using the default alert settings for this account.
        </p>
      )}
    </article>
  );
}
