import { Form } from "react-router";

import { SubmitButton } from "~/components/submit-button";
import type { EffectiveDeliveryConfig, WatchlistDeliveryConfigRecord } from "~/lib/types";

export function DeliverySettingsCard(props: {
  data: {
    plan: string;
    effectiveDeliveryConfig: EffectiveDeliveryConfig;
    watchlistDeliveryConfig: WatchlistDeliveryConfigRecord | null;
    whatsappAvailable: boolean;
  };
  watchlistId: string;
  canConfigureDigestSettings: boolean;
  canInstantAlert: boolean;
  canEmailDelivery: boolean;
  showSlackDelivery: boolean;
  showTeamsDelivery: boolean;
}) {
  const {
    data,
    watchlistId,
    canConfigureDigestSettings,
    canInstantAlert,
    canEmailDelivery,
    showSlackDelivery,
    showTeamsDelivery,
  } = props;
  return (
    <article className="f9-detail-cell">
      <p className="f9-wk-kick">Delivery settings</p>
      <h3>Channel policy</h3>
      {!data.watchlistDeliveryConfig ? (
        <p className="f9-wk-dim">
          Using the default alert settings for this account.
        </p>
      ) : null}
      {canConfigureDigestSettings ? <Form method="post" className="f9-wk-worklist is-compact">
        <input name="intent" type="hidden" value="save-delivery-config" />
        <input name="watchlistId" type="hidden" value={watchlistId} />
        <label className="f9-field">
          <span>Sensitivity</span>
          <select defaultValue={data.effectiveDeliveryConfig.sensitivityMode} name="sensitivityMode">
            <option value="quiet">Quiet</option>
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
            <option value="auto">Auto (Balanced)</option>
          </select>
        </label>
        <label className="f9-field">
          <span>Timezone</span>
          <input
            defaultValue={data.effectiveDeliveryConfig.timezone ?? "UTC"}
            aria-describedby="delivery-timezone-help"
            name="timezone"
            type="text"
          />
          <small className="f9-wk-dim" id="delivery-timezone-help">
            Use an IANA timezone such as Asia/Kolkata or UTC.
          </small>
        </label>
        <div className="f9-field-pair">
          <label className="f9-field">
            <span>Quiet hours start</span>
            <input
              defaultValue={data.effectiveDeliveryConfig.quietHours?.startHour ?? 22}
              name="quietHoursStart"
              type="number"
            />
          </label>
          <label className="f9-field">
            <span>Quiet hours end</span>
            <input
              defaultValue={data.effectiveDeliveryConfig.quietHours?.endHour ?? 8}
              name="quietHoursEnd"
              type="number"
            />
          </label>
        </div>
        {canInstantAlert ? (
          <label className="f9-field f9-field-inline">
            <input defaultChecked={data.effectiveDeliveryConfig.instantEnabled} name="instantEnabled" type="checkbox" />
            <span>High-priority alerts (sent as soon as a scan confirms a major change)</span>
          </label>
        ) : (
          <div className="f9-field">
            <label className="f9-field-inline">
              <input disabled type="checkbox" />
              <span>High-priority alerts require Starter.</span>
            </label>
          </div>
        )}
        <label className="f9-field f9-field-inline">
          <input defaultChecked={data.effectiveDeliveryConfig.digestEnabled} name="digestEnabled" type="checkbox" />
          <span>{data.plan === "free" ? "Weekly digest email" : "Digest alerts"}</span>
        </label>
        {canEmailDelivery ? (
          <label className="f9-field f9-field-inline">
            <input defaultChecked={data.effectiveDeliveryConfig.emailEnabled} name="emailEnabled" type="checkbox" />
            <span>Email enabled</span>
          </label>
        ) : (
          <label className="f9-field f9-field-inline">
            <input disabled type="checkbox" />
            <span>
              Email delivery requires Scout.
            </span>
          </label>
        )}
        {data.whatsappAvailable ? (
          <label className="f9-field f9-field-inline">
            <input defaultChecked={data.effectiveDeliveryConfig.whatsappEnabled} name="whatsappEnabled" type="checkbox" />
            <span>WhatsApp enabled</span>
          </label>
        ) : null}
        {showSlackDelivery ? (
        <label className="f9-field f9-field-inline">
          <input defaultChecked={data.effectiveDeliveryConfig.slackEnabled} name="slackEnabled" type="checkbox" />
          <span>Slack enabled</span>
        </label>
        ) : null}
        {showTeamsDelivery ? (
        <label className="f9-field f9-field-inline">
          <input defaultChecked={data.effectiveDeliveryConfig.teamsEnabled} name="teamsEnabled" type="checkbox" />
          <span>Teams enabled</span>
        </label>
        ) : null}
        <SubmitButton className="f9-evidence-cta f9-evidence-cta--rank2" intent="save-delivery-config" pendingLabel="Saving…">
          Save delivery settings
        </SubmitButton>
      </Form> : (
        <div className="f9-wk-worklist is-compact">
          <p className="f9-wk-dim">
            Delivery settings are managed by the workspace owner.
          </p>
        </div>
      )}
    </article>
  );
}
