import { Form } from "react-router";

import {
  COLLECTION_PANEL_GROUP,
  CollectionDisclosure,
} from "~/components/collections/collection-disclosure";
import { SubmitButton } from "~/components/submit-button";

const externalProofChannels = [
  "TikTok",
  "Google / YouTube",
  "LinkedIn",
  "Pinterest",
  "Meta",
  "Landing page",
  "Other",
];

export function CollectionExternalProofSection({
  collectionId,
  defaultOpen = false,
}: {
  collectionId: string;
  defaultOpen?: boolean;
}) {
  return (
    <section aria-labelledby="collection-file-title" className="f9-wk-sec f9-library-section">
      <h2 className="f9-library-section-title" id="collection-file-title">
        File evidence from another source
      </h2>
      <p className="f9-library-note">
        Add an ad or landing page we do not scan ourselves. It stays labelled as
        team-filed evidence, with the date you saw it.
      </p>
      <CollectionDisclosure
        className="f9-library-external"
        defaultOpen={defaultOpen}
        group={COLLECTION_PANEL_GROUP}
        summary="Add an evidence link"
      >
        <Form className="f9-library-form" method="post">
          <input name="intent" type="hidden" value="add-external-proof" />
          <input name="collectionId" type="hidden" value={collectionId} />
          <div className="f9-field-grid">
            <label className="f9-field">
              <span>Channel</span>
              <select name="channel" defaultValue="TikTok">
                {externalProofChannels.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </label>
            <label className="f9-field">
              <span>Advertiser</span>
              <input name="advertiser" placeholder="Competitor name" required />
            </label>
          </div>
          <label className="f9-field">
            <span>Evidence URL</span>
            <input name="proofUrl" placeholder="https://..." required type="url" />
          </label>
          <label className="f9-field">
            <span>Hook</span>
            <input name="hook" placeholder="Main claim, hook, or visible change" required />
          </label>
          <div className="f9-field-grid">
            <label className="f9-field">
              <span>Offer</span>
              <input name="offer" placeholder="Optional offer" />
            </label>
            <label className="f9-field">
              <span>CTA</span>
              <input name="cta" placeholder="Optional CTA" />
            </label>
          </div>
          <div className="f9-field-grid">
            <label className="f9-field">
              <span>Observed</span>
              <input name="observedAt" type="date" />
            </label>
            <label className="f9-field">
              <span>Tags</span>
              <input name="tags" placeholder="campaign, launch, offer" />
            </label>
          </div>
          <div className="f9-field-grid">
            <label className="f9-field">
              <span>Spend</span>
              <input name="spend" placeholder="Visible spend" />
            </label>
            <label className="f9-field">
              <span>Impressions</span>
              <input name="impressions" placeholder="Visible impressions" />
            </label>
          </div>
          <label className="f9-field">
            <span>Reach</span>
            <input name="reach" placeholder="Visible reach" />
          </label>
          <label className="f9-field">
            <span>Note</span>
            <textarea name="note" placeholder="Optional team context" rows={2} />
          </label>
          <SubmitButton
            className="f9-wk-lnk"
            intent="add-external-proof"
            pendingLabel="Saving…"
          >
            Save evidence link
          </SubmitButton>
        </Form>
      </CollectionDisclosure>
    </section>
  );
}
