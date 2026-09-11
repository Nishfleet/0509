import { Form } from "react-router";

import { SubmitButton } from "~/components/submit-button";
import { isHttpCompetitorWebsite } from "~/lib/competitor-website";

export function WatchlistSetupCard(props: {
  data: {
    selectedWatchlist: { id: string; name: string; targetId: string; targetLabel: string };
  };
}) {
  const { data } = props;
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
        <label className="f9-field">
          <span>Brand or search term</span>
          <input
            defaultValue={
              isHttpCompetitorWebsite(data.selectedWatchlist.targetId)
                ? data.selectedWatchlist.targetId
                : data.selectedWatchlist.targetLabel
            }
            name="targetLabel"
            placeholder="nykaa.com or skincare serum"
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
