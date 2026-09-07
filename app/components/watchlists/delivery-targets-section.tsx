import { Form } from "react-router";

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
          <p className="f9-wk-kick">Delivery targets</p>
          <h3 className="f9-wk-mt0">Targets and pauses</h3>
        </div>
      </div>
      <div className="f9-detail-split">
      <div className="f9-detail-cell">
      <p className="f9-wk-kick">Watchlist targets</p>
      {data.canManageDelivery ? <div className="f9-wk-worklist is-compact">
        {data.deliveryTargets.map((target) => (
          <div className="f9-wk-workrow" key={target.id}>
            <div>
              <h4 className="f9-wk-mb025">
                {deliveryChannelLabel(target.channel)}
              </h4>
              <p className="f9-wk-dim">
                {toPublicDeliveryTarget(target, {
                  verifiedAccountEmail: data.verifiedAccountEmail,
                }).targetValue}
              </p>
              <p className="f9-wk-dim">
                {target.isPaused
                  ? "Paused"
                  : target.channel === "whatsapp" && !data.whatsappAvailable
                    ? "Not available — email is the delivery channel"
                    : target.channel === "whatsapp" && !target.templateEligible
                      ? "Waiting for WhatsApp approval"
                      : "Ready"}
              </p>
            </div>
            <div className="f9-wk-row-gap">
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
                    className="f9-evidence-cta f9-evidence-cta--rank3"
                    intent="send-test-email"
                    match={{ targetId: target.id }}
                    pendingLabel="Sending…"
                  >
                    Send test
                  </SubmitButton>
                </Form>
              ) : target.channel === "email" ? (
                <span className="f9-wk-dim">Email requires Scout</span>
              ) : null}
              <Form method="post">
                <input name="intent" type="hidden" value="toggle-delivery-target" />
                <input name="targetId" type="hidden" value={target.id} />
                <SubmitButton
                  className="f9-evidence-cta f9-evidence-cta--rank3"
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
          <p className="f9-wk-dim">
            Using the default delivery target until you add one for this competitor.
          </p>
        ) : null}
      </div> : (
        <div className="f9-wk-worklist is-compact">
          <p className="f9-wk-dim">
            Delivery settings and recipient targets are managed by the workspace owner.
          </p>
          {data.verifiedAccountEmail ? (
            <p className="f9-wk-dim">Your verified account email: {data.verifiedAccountEmail}</p>
          ) : null}
        </div>
      )}
      {data.workspaceDeliveryTargets.length > 0 ? (
        <div>
          <p className="f9-wk-kick">Default delivery</p>
          <div className="f9-wk-worklist is-compact">
            {data.workspaceDeliveryTargets.map((target) => {
              // The workspace-default email row is the address the /unsubscribe
              // promise points back to: pausing here suppresses it, resuming
              // clears the opt-out set by the one-click unsubscribe link.
              const paused = target.isPaused;
              return (
                <div className="f9-wk-workrow" key={target.id}>
                  <div>
                    <h4 className="f9-wk-mb025">
                      {target.channel === "email"
                        ? "Workspace default email"
                        : `Workspace default ${deliveryChannelLabel(target.channel)}`}
                    </h4>
                    <p className="f9-wk-dim">
                      {toPublicDeliveryTarget(target, {
                        verifiedAccountEmail: data.verifiedAccountEmail,
                      }).targetValue}
                    </p>
                    <p className="f9-wk-dim">
                      {paused
                        ? "Paused — digests and alerts are switched off"
                        : target.channel === "whatsapp" && !data.whatsappAvailable
                          ? "Not available — email is the delivery channel"
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
                        className="f9-evidence-cta f9-evidence-cta--rank3"
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
        <p className="f9-wk-kick">Add delivery target</p>
        <input name="intent" type="hidden" value="add-delivery-target" />
        <input name="watchlistId" type="hidden" value={watchlistId} />
        {/* Email is the delivery channel; a one-option select was theater. */}
        <input name="channel" type="hidden" value="email" />
        <label className="f9-field">
          <span>Email address</span>
          <input
            name="targetValue"
            placeholder="owner@example.com"
            type="text"
          />
        </label>
        <label className="f9-field f9-field-inline">
          <input defaultChecked name="explicitOptIn" type="checkbox" />
          <span>Explicit opt-in confirmed</span>
        </label>
        <SubmitButton className="f9-evidence-cta f9-evidence-cta--rank2" intent="add-delivery-target" pendingLabel="Adding…">
          Add delivery target
        </SubmitButton>
      </Form> : (
        <div className="f9-detail-cell">
          <p className="f9-wk-kick">Add delivery target</p>
          {data.canManageDelivery ? (
            <>
              <p className="f9-wk-dim">
                Paid plans can send proof-backed alerts to email. Use Upgrade plan above to
                compare options.
              </p>
            </>
          ) : (
            <p className="f9-wk-dim">
              Ask the workspace owner to add or change delivery targets.
            </p>
          )}
        </div>
      )}
      </div>
    </section>
  );
}

function deliveryChannelLabel(channel: string) {
  if (channel === "slack") return "Slack";
  if (channel === "teams") return "Teams";
  if (channel === "whatsapp") return "WhatsApp";
  return "Email";
}
