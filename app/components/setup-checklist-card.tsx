import { useEffect, useState } from "react";
import { Form, Link, useFetcher } from "react-router";

import { PrimaryAction, TertiaryAction } from "~/components/evidence/cta";
import { SubmitButton } from "~/components/submit-button";
import { normalizeCompetitorWebsiteInput } from "~/lib/competitor-website";
import type { CompetitorImportPreview, CompetitorImportRow } from "~/lib/competitor-import";
import { getPlanLimit } from "~/lib/plan-entitlements";
import {
  blockingSetupItems,
  isBlockingSetupItemComplete,
  pendingBlockingSetupItems,
} from "~/lib/setup-checklist";
import type { WorkspaceReadiness } from "~/lib/workspace-readiness.server";

type SetupActionData = {
  ok?: boolean;
  intent?: string;
  message?: string;
  error?: string;
  upgradePath?: string;
  preview?: CompetitorImportPreview;
  rawText?: string;
};

const SETUP_ACTION_INTENTS = new Set([
  "create-watchlist",
  "preview-market-desk-import",
  "create-market-desk-import",
  "finish",
]);

export function SetupChecklistCard({
  readiness,
  actionData,
  prefillWebsite = "",
  prefillCountry = "",
}: {
  readiness: WorkspaceReadiness;
  actionData?: SetupActionData;
  prefillWebsite?: string;
  prefillCountry?: string;
}) {
  const items = blockingSetupItems(readiness);
  const pendingItems = pendingBlockingSetupItems(readiness);
  const nextItem = pendingItems[0] ?? null;
  const readyCount = items.filter((item) => isBlockingSetupItemComplete(readiness, item)).length;
  const hasWatchlistCapacity =
    (readiness.counts?.activeWatchlists ?? 0) <
    getPlanLimit(readiness.billing?.plan ?? "free", "watchlists");
  /**
   * The "track this competitor" submit is a FETCHER, not a navigating form.
   *
   * `app.dashboard.tsx` is the index child of `/app` (`app/routes.ts`), so a
   * navigating `<Form method="post">` here resolves its action to `/app?index`
   * — React Router's index-route marker — and pushes that into the address
   * bar. On the success path the action redirects, so nobody saw it; on any
   * refusal path (a plan limit, an unverified email, a website the server
   * could not normalize) the action returns data and the customer is left
   * looking at `0509.io/app?index`, a leaked framework detail. A fetcher
   * submits without navigating, so the URL stays exactly `/app`; redirects
   * thrown by the action are still followed, so creating the first watchlist
   * still lands on `/app/watchlists?watchlist=…`.
   *
   * Salvaged from the parked BL-025 stack (PR #416, 7642826/f761dd7) — its
   * behavioural fixes were certified by review; its visuals were not.
   */
  const createFetcher = useFetcher<SetupActionData>();
  const fetcherData = createFetcher.data;
  const routeActionData =
    actionData?.intent && SETUP_ACTION_INTENTS.has(actionData.intent)
      ? actionData
      : undefined;
  /**
   * There is ONE feedback slot on this card and two submission lanes feeding
   * it: the quick-create fetcher above, and the bulk-import forms below, which
   * are still navigating `<Form>`s answering through the route action. The
   * slot belongs to whichever lane answered LAST.
   *
   * This has to be tracked, not derived: React Router retains `fetcher.data`
   * after the fetcher returns to idle, so "fetcher data wins when present"
   * makes the first refusal permanent — a later import preview completes on
   * the server and is then invisible until a full page reload. Same idiom as
   * the coexisting fetcher/route-action feedback on `app/routes/app.watchlists.tsx`.
   */
  const [latestFeedbackSource, setLatestFeedbackSource] = useState<
    "route" | "fetcher" | null
  >(null);
  useEffect(() => {
    if (routeActionData) setLatestFeedbackSource("route");
  }, [routeActionData]);
  useEffect(() => {
    if (fetcherData) setLatestFeedbackSource("fetcher");
  }, [fetcherData]);
  const setupActionData =
    latestFeedbackSource === "fetcher" &&
    fetcherData?.intent &&
    SETUP_ACTION_INTENTS.has(fetcherData.intent)
      ? fetcherData
      : routeActionData;
  const creatingWatchlist = createFetcher.state !== "idle";
  const importPreview = setupActionData?.preview ?? null;
  const hasActionableImportPreview = Boolean(
    importPreview && importPreview.selectedCount > 0,
  );
  const [website, setWebsite] = useState(prefillWebsite);
  const normalizedWebsite = normalizeCompetitorWebsiteInput(website);
  const canSubmitWebsite = Boolean(website.trim()) && !normalizedWebsite.error;
  const nextIsCompetitor = nextItem?.id === "first_competitor";

  if (!nextItem) return null;

  return (
    <section
      aria-labelledby="setup-checklist-title"
      className="f9-evidence-setup-card"
      id="setup-checklist"
    >
      <header className="f9-evidence-setup-header">
        <span className="f9-evidence-micro">
          Setup · {readyCount} of {items.length} done
        </span>
        <h2 id="setup-checklist-title">Finish the workspace that sends your first brief</h2>
      </header>

      {setupActionData?.message ? (
        <div
          aria-live={setupActionData.ok ? "polite" : "assertive"}
          className={`f9-wk-notice ${setupActionData.ok ? "is-success" : "is-error"}`}
          role={setupActionData.ok ? "status" : "alert"}
        >
          <p>{setupActionData.message}</p>
          {!setupActionData.ok && setupActionData.upgradePath ? (
            <Link to={setupActionData.upgradePath}>View plans</Link>
          ) : null}
        </div>
      ) : null}

      {!hasActionableImportPreview && nextIsCompetitor ? (
        <createFetcher.Form className="f9-evidence-setup-primary" method="post">
          <input name="intent" type="hidden" value="create-watchlist" />
          <input name="country" type="hidden" value={prefillCountry} />
          <label className="f9-field" htmlFor="setup-competitor-website">
            <span>Competitor website</span>
            <input
              aria-describedby="setup-competitor-hint"
              aria-invalid={Boolean(normalizedWebsite.error)}
              autoComplete="url"
              id="setup-competitor-website"
              inputMode="url"
              name="website"
              onChange={(event) => setWebsite(event.currentTarget.value)}
              placeholder="https://competitor.com"
              spellCheck={false}
              type="text"
              value={website}
            />
          </label>
          <small className="f9-evidence-setup-hint" id="setup-competitor-hint">
            {normalizedWebsite.error ?? "We create the watchlist and start its first scan immediately."}
          </small>
          <SubmitButton
            className="f9-evidence-cta f9-evidence-cta--rank1"
            disabled={!canSubmitWebsite}
            intent="create-watchlist"
            // A fetcher submit never enters `useNavigation()`, so the pending
            // state has to come from the fetcher itself — otherwise the
            // in-flight treatment would silently stop firing for this button.
            pending={creatingWatchlist}
            pendingLabel="Starting first scan…"
          >
            Track {normalizedWebsite.displayName ?? "this competitor"}
          </SubmitButton>
        </createFetcher.Form>
      ) : !hasActionableImportPreview && nextItem.action ? (
        <div className="f9-evidence-action-row">
          <PrimaryAction to={nextItem.action.href}>{nextItem.action.label}</PrimaryAction>
        </div>
      ) : null}

      <ol className="f9-evidence-setup-list">
        {items.map((item) => {
          const done = isBlockingSetupItemComplete(readiness, item);
          const isNext = item.id === nextItem.id;
          return (
            <li
              aria-current={isNext ? "step" : undefined}
              className="f9-evidence-setup-row"
              data-state={done ? "done" : isNext ? "next" : "pending"}
              key={item.id}
            >
              <span className="f9-evidence-setup-stamp">
                {done ? "Done" : isNext ? "Next" : "Pending"}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </li>
          );
        })}
      </ol>

      {hasWatchlistCapacity ? (
        <details className="f9-evidence-setup-import" open={Boolean(importPreview) || undefined}>
          <summary>Add several competitors by paste or CSV</summary>
          <Form encType="multipart/form-data" method="post">
          <label className="f9-field">
            <span>Competitors</span>
            <textarea
              defaultValue={setupActionData?.rawText ?? ""}
              name="competitors"
              placeholder={"competitor.com\nbrand two\nname,website,notes,tags,client"}
              rows={5}
              spellCheck={false}
            />
            <small>Paste domains, URLs, names, or CSV rows. Existing competitors and plan limits are checked before any write.</small>
          </label>
          <label className="f9-field">
            <span>CSV or text file</span>
            <input accept=".csv,.txt,text/csv,text/plain" name="competitorFile" type="file" />
          </label>
          {importPreview ? <ImportPreview preview={importPreview} /> : null}
          <div className="f9-evidence-action-row">
            <SubmitButton
              className="f9-evidence-cta f9-evidence-cta--rank2"
              intent="preview-market-desk-import"
              name="intent"
              pendingLabel="Checking…"
              value="preview-market-desk-import"
            >
              Preview import
            </SubmitButton>
            {hasActionableImportPreview && importPreview ? (
              <SubmitButton
                className="f9-evidence-cta f9-evidence-cta--rank1"
                intent="create-market-desk-import"
                name="intent"
                pendingLabel="Creating…"
                value="create-market-desk-import"
              >
                {importPreview.selectedCount === 1
                  ? "Create watchlist"
                  : `Create ${importPreview.selectedCount} watchlists`}
              </SubmitButton>
            ) : null}
          </div>
          </Form>
        </details>
      ) : (
        <p className="f9-evidence-setup-capacity">
          Your current plan is at its competitor limit.{" "}
          <TertiaryAction to="/app/billing?source=setup-checklist#plans">
            View plans
          </TertiaryAction>
        </p>
      )}

      <div className="f9-evidence-setup-links">
        <TertiaryAction href={website.trim() ? `/search?website=${encodeURIComponent(website.trim())}` : "/search"}>
          Search first instead
        </TertiaryAction>
        <TertiaryAction to="/app/account#brand-profile">Add your brand website</TertiaryAction>
      </div>
    </section>
  );
}

export function ImportPreview({ preview }: { preview: CompetitorImportPreview }) {
  const rejectedColumns = preview.rejectedColumns ?? [];
  return (
    <section aria-label="Competitor import preview" className="f9-import-preview">
      {rejectedColumns.length > 0 ? (
        <p className="f9-import-rejected" role="note">
          Columns not imported:{" "}
          {rejectedColumns.map((column) => (
            <code key={column}>{column}</code>
          ))}
          . Keep your original file as the record of what the import carried.
        </p>
      ) : null}
      <div aria-label="Import summary" className="f9-import-summary">
        <span>{preview.summary.valid} ready</span>
        <span>{preview.summary.over_cap} over plan</span>
        <span>{preview.summary.duplicate + preview.summary.existing} already covered</span>
        <span>{preview.summary.invalid} needs edit</span>
      </div>
      <div className="f9-import-table">
        {preview.rows.map((row) => <ImportRow key={row.id} row={row} />)}
      </div>
    </section>
  );
}

export function ImportRow({ row }: { row: CompetitorImportRow }) {
  const disabled = row.status === "invalid" || row.status === "duplicate" || row.status === "existing";
  return (
    <label className={`f9-import-row is-${row.status}`}>
      <input defaultChecked={row.selected} disabled={disabled} name="selectedRowIds" type="checkbox" value={row.id} />
      <span>
        <strong>{row.target?.targetLabel ?? row.name ?? row.website ?? row.raw}</strong>
        <small>{row.host ?? row.website ?? row.target?.targetId ?? "Competitor name"}</small>
      </span>
      <em>{importStatusLabel(row)}</em>
    </label>
  );
}

function importStatusLabel(row: CompetitorImportRow) {
  if (row.status === "valid") return row.selected ? "Selected" : "Ready";
  if (row.status === "over_cap") return "Over plan";
  if (row.status === "duplicate") return "Duplicate";
  if (row.status === "existing") return "Already tracked";
  return row.reason ?? "Needs edit";
}
