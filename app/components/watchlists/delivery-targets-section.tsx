import { Form } from "react-router";

import { TertiaryAction } from "~/components/evidence/cta";
import { SubmitButton } from "~/components/submit-button";
import {
  toPublicDeliveryTarget,
  type PublicDeliveryTargetRecord,
} from "~/lib/delivery-target-public";

export function DeliveryTargetsSection(props: {
  data: {
    canManageDelivery: boolean;
    deliveryTargets: PublicDeliveryTargetRecord[];
    workspaceDeliveryTargets: PublicDeliveryTargetRecord[];
    verifiedAccountEmail: string | null;
    whatsappAvailable: boolean;
    deliveryTestRequestTokens: Record<string, string>;
  };
  watchlistId: string;
  canEmailDelivery: boolean;
  canConfigureDelivery: boolean;
}) {
  const { data, watchlistId, canEmailDelivery, canConfigureDelivery } = props;
  return (
    <section>
      <div className="f9-panel-toolbar">
        <div>
          <p className="f9-app-kicker">Delivery targets</p>
          <h3 style={{ marginTop: 0 }}>Targets and pauses</h3>
        </div>
      </div>
      <div className="f9-detail-split">
      <div className="f9-detail-cell">
      <p className="f9-app-kicker">Watchlist targets</p>
      {data.canManageDelivery ? <div className="f9-work-list is-compact">
        {data.deliveryTargets.map((target) => (
          <div className="f9-work-row" key={target.id}>
            <div>
              <h4 style={{ marginBottom: "0.25rem" }}>
                {target.channel === "email" ? "Email" : "WhatsApp"}
              </h4>
              <p className="f9-muted-copy">
                {toPublicDeliveryTarget(target, {
                  verifiedAccountEmail: data.verifiedAccountEmail,
                }).targetValue}
              </p>
              <p className="f9-muted-copy">
                {target.isPaused
                  ? "Paused"
                  : target.channel === "whatsapp" && !data.whatsappAvailable
                    ? "Not yet available — WhatsApp delivery isn't live"
                    : target.channel === "whatsapp" && !target.templateEligible
                      ? "Waiting for WhatsApp approval"
                      : "Ready"}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {target.channel === "email" && canEmailDelivery ? (
                <Form method="post">
                  <input name="intent" type="hidden" value="send-test-email" />
                  <input name="targetId" type="hidden" value={target.id} />
                  <input
                    name="requestToken"
                    type="hidden"
                    value={data.deliveryTestRequestTokens[target.id] ?? ""}
                  />
                  <SubmitButton
                    className="f9-ed-cta f9-ed-cta--rank3"
                    intent="send-test-email"
                    match={{ targetId: target.id }}
                    pendingLabel="Sending…"
                  >
                    Send test
                  </SubmitButton>
                </Form>
              ) : target.channel === "email" ? (
                <TertiaryAction to="/app/billing?source=watchlists#plans">
                  Upgrade for email
                </TertiaryAction>
              ) : null}
              <Form method="post">
                <input name="intent" type="hidden" value="toggle-delivery-target" />
                <input name="targetId" type="hidden" value={target.id} />
                <SubmitButton
                  className="f9-ed-cta f9-ed-cta--rank3"
                  intent="toggle-delivery-target"
                  match={{ targetId: target.id }}
                  pendingLabel={target.isPaused ? "Resuming…" : "Pausing…"}
                >
                  {target.isPaused ? "Resume" : "Pause"}
                </SubmitButton>
              </Form>
            </div>
          </div>
        ))}
        {data.deliveryTargets.length === 0 ? (
          <p className="f9-muted-copy">
            Using the default delivery target until you add one for this competitor.
          </p>
        ) : null}
      </div> : (
        <div className="f9-work-list is-compact">
          <p className="f9-muted-copy">
            Delivery settings and recipient targets are managed by the workspace owner.
          </p>
          {data.verifiedAccountEmail ? (
            <p className="f9-muted-copy">Your verified account email: {data.verifiedAccountEmail}</p>
          ) : null}
        </div>
      )}
      {data.workspaceDeliveryTargets.length > 0 ? (
        <div>
          <p className="f9-app-kicker">Default delivery</p>
          <div className="f9-work-list is-compact">
            {data.workspaceDeliveryTargets.map((target) => {
              // The workspace-default email row is the address the /unsubscribe
              // promise points back to: pausing here suppresses it, resuming
              // clears the opt-out set by the one-click unsubscribe link.
              const paused = target.isPaused;
              return (
                <div className="f9-work-row" key={target.id}>
                  <div>
                    <h4 style={{ marginBottom: "0.25rem" }}>
                      {target.channel === "email"
                        ? "Workspace default email"
                        : "Workspace default WhatsApp"}
                    </h4>
                    <p className="f9-muted-copy">
                      {toPublicDeliveryTarget(target, {
                        verifiedAccountEmail: data.verifiedAccountEmail,
                      }).targetValue}
                    </p>
                    <p className="f9-muted-copy">
                      {paused
                        ? "Paused — digests and alerts are switched off"
                        : target.channel === "whatsapp" && !data.whatsappAvailable
                          ? "Not yet available — WhatsApp delivery isn't live"
                          : target.channel === "whatsapp" && !target.templateEligible
                            ? "Waiting for WhatsApp approval"
                            : "Ready"}
                    </p>
                  </div>
                  {data.canManageDelivery && target.channel === "email" ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="toggle-delivery-target" />
                      <input name="targetId" type="hidden" value={target.id} />
                      <SubmitButton
                        className="f9-ed-cta f9-ed-cta--rank3"
                        intent="toggle-delivery-target"
                        match={{ targetId: target.id }}
                        pendingLabel={paused ? "Resuming…" : "Pausing…"}
                      >
                        {paused ? "Resume" : "Pause"}
                      </SubmitButton>
                    </Form>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      </div>

      {canConfigureDelivery ? <Form method="post" className="f9-detail-cell">
        <p className="f9-app-kicker">Add delivery target</p>
        <input name="intent" type="hidden" value="add-delivery-target" />
        <input name="watchlistId" type="hidden" value={watchlistId} />
        <label className="f9-field">
          <span>Channel</span>
          <select defaultValue="email" name="channel">
            <option value="email">Email</option>
            {data.whatsappAvailable ? (
              <option value="whatsapp">WhatsApp</option>
            ) : null}
          </select>
        </label>
        <label className="f9-field">
          <span>Target</span>
          <input
            name="targetValue"
            placeholder={data.whatsappAvailable ? "owner@example.com or +919999999999" : "owner@example.com"}
            type="text"
          />
        </label>
        <label className="f9-field f9-field-inline">
          <input defaultChecked name="explicitOptIn" type="checkbox" />
          <span>Explicit opt-in confirmed</span>
        </label>
        <SubmitButton className="f9-ed-cta f9-ed-cta--rank2" intent="add-delivery-target" pendingLabel="Adding…">
          Add delivery target
        </SubmitButton>
      </Form> : (
        <div className="f9-detail-cell">
          <p className="f9-app-kicker">Add delivery target</p>
          {data.canManageDelivery ? (
            <>
              <p className="f9-muted-copy">
                Paid plans can send proof-backed alerts to email. Upgrade to add a delivery target.
              </p>
              <TertiaryAction to="/app/billing?source=watchlists#plans">
                Upgrade for delivery
              </TertiaryAction>
            </>
          ) : (
            <p className="f9-muted-copy">
              Ask the workspace owner to add or change delivery targets.
            </p>
          )}
        </div>
      )}
      </div>
    </section>
  );
}
