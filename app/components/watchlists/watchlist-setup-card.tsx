import { Form } from "react-router";

import { SubmitButton } from "~/components/submit-button";
import { isHttpCompetitorWebsite } from "~/lib/competitor-website";
import { formatWatchlistTrackingRole } from "~/lib/watchlist-role";
import type { WatchlistTrackingRole } from "~/lib/types";

export function WatchlistSetupCard(props: {
  data: {
    selectedWatchlist: { id: string; name: string; targetId: string; targetLabel: string };
  };
  selectedTrackingRole: WatchlistTrackingRole;
}) {
  const { data, selectedTrackingRole } = props;
  return (
    <section className="f9-detail-cell">
      <p className="f9-wk-kick">Watchlist setup</p>
      <Form method="post" className="f9-wk-worklist is-compact">
        <input name="intent" type="hidden" value="update-watchlist" />
        <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
        <label className="f9-field">
          <span>Name</span>
          <input
            defaultValue={data.selectedWatchlist.name}
            name="name"
            placeholder="Nykaa launch watch"
            type="text"
          />
        </label>
        <div className="f9-mode-toggle" aria-label="Track as">
          <label className={selectedTrackingRole === "competitor" ? "is-active" : ""}>
            <input
              defaultChecked={selectedTrackingRole === "competitor"}
              name="trackingRole"
              type="radio"
              value="competitor"
            />
            Competitor
          </label>
          <label className={selectedTrackingRole === "self" ? "is-active" : ""}>
            <input
              defaultChecked={selectedTrackingRole === "self"}
              name="trackingRole"
              type="radio"
              value="self"
            />
            My brand
          </label>
        </div>
        <label className="f9-field">
          <span>{formatWatchlistTrackingRole(selectedTrackingRole)} website</span>
          <input
            defaultValue={
              isHttpCompetitorWebsite(data.selectedWatchlist.targetId)
                ? data.selectedWatchlist.targetId
                : ""
            }
            name="competitorWebsite"
            placeholder="https://nykaa.com"
            type="text"
          />
        </label>
        <label className="f9-field">
          <span>Brand or search term</span>
          <input
            defaultValue={data.selectedWatchlist.targetLabel}
            name="targetLabel"
            placeholder={selectedTrackingRole === "self" ? "Samplebrand" : "Nykaa, Mamaearth, skincare serum"}
            type="text"
          />
        </label>
        <SubmitButton className="f9-evidence-cta f9-evidence-cta--rank2" intent="update-watchlist" pendingLabel="Saving…">
          Save watchlist
        </SubmitButton>
      </Form>
    </section>
  );
}
