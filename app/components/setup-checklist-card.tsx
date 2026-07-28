import { useState } from "react";
import { Form, useFetcher } from "react-router";

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
   * bar. On the success path the action redirects, so nobody saw it; on the
   * refusal path the action returns data and the customer is left looking at
   * `0509.io/app?index`, a leaked framework detail. That same non-canonical
   * URL is what made Gate-B's coverage annotation unresolvable and caused the
   * first BL-025 review BLOCK.
   *
   * A fetcher submits without navigating, so the URL stays exactly `/app`.
   * Redirects thrown by the action are still followed, so creating the first
   * watchlist still lands on `/app/watchlists?watchlist=…`.
   */
  const createFetcher = useFetcher<SetupActionData>();
  const fetcherData = createFetcher.data;
  const routeActionData =
    actionData?.intent && SETUP_ACTION_INTENTS.has(actionData.intent)
      ? actionData
      : undefined;
  // The fetcher owns the create-watchlist result; the route action still owns
  // the import intents, which post through a navigating <Form>.
  const setupActionData =
    fetcherData?.intent && SETUP_ACTION_INTENTS.has(fetcherData.intent)
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
      className="f9-ed-setup-card"
      id="setup-checklist"
    >
      {/* Brief §6.11 ink header — a STRIP, not a sheet. It carries mono only:
          the ink/inverted treatment is an accent in this system (plate headers,
          cover blocks), and a full panel of it reads as a rendering error on
          the dark ground (BL-025, Nish 2026-07-28). */}
      <header className="f9-ed-setup-strip">
        <span className="f9-ed-micro">
          Setup · {readyCount} of {items.length} done
        </span>
        <span aria-hidden="true" className="f9-ed-setup-ticks">
          {items.map((item) => (
            <i
              data-state={
                isBlockingSetupItemComplete(readiness, item)
                  ? "done"
                  : item.id === nextItem.id
                    ? "next"
                    : "pending"
              }
              key={item.id}
            />
          ))}
        </span>
      </header>

      {/* Brief §6.3 status strip: the four steps as ONE ruled row of key/value
          cells, replacing four repeated title+sentence rows (§6.6 kills the
          micro-label stack). Each cell states its own step in words, so colour
          is never the only channel (§10). */}
      <ol aria-label="Setup steps" className="f9-ed-status-strip f9-ed-setup-track">
        {items.map((item) => {
          const done = isBlockingSetupItemComplete(readiness, item);
          const isNext = item.id === nextItem.id;
          return (
            <li
              aria-current={isNext ? "step" : undefined}
              className="f9-ed-status-cell"
              data-state={done ? "done" : isNext ? "next" : "pending"}
              key={item.id}
            >
              <span aria-hidden="true" className="f9-ed-setup-track-bar" />
              <span className="f9-ed-status-key">{item.label}</span>
              <span className="f9-ed-status-value">
                {done ? "Done" : isNext ? "Now" : "Still to come"}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="f9-ed-setup-body">
        <div className="f9-ed-setup-lede">
          <h2 id="setup-checklist-title">Finish the workspace that sends your first brief</h2>
          <p>{nextItem.detail}</p>
        </div>

        {/* The feedback and the control it belongs to are ONE grid item, so an
            error can never reflow the two-column composition or land a column
            away from the field it is about. */}
        <div className="f9-ed-setup-action">
        {/* BL-025 F2: this is the moment the always-enabled Rank-1 hands the
            customer, so it cannot arrive as a rounded soft-shadow banner
            inside a zero-radius desk card. Desk geometry, a mono state stamp,
            and the recovery as a real Rank-3 — not a floating text link (§5
            retired styles). The stamp is a state LABEL, never a claim: an
            `ok: false` import can still have created some rows
            (`setup-checklist-action.server.ts`), so nothing here asserts that
            nothing happened. */}
        {setupActionData?.message ? (
          <div
            aria-live={setupActionData.ok ? "polite" : "assertive"}
            className={`f9-ed-setup-message ${setupActionData.ok ? "is-success" : "is-error"}`}
            role={setupActionData.ok ? "status" : "alert"}
          >
            <span className="f9-ed-micro">{setupActionData.ok ? "Done" : "Not done yet"}</span>
            <p>{setupActionData.message}</p>
            {!setupActionData.ok && setupActionData.upgradePath ? (
              <TertiaryAction to={setupActionData.upgradePath}>View plans</TertiaryAction>
            ) : null}
          </div>
        ) : null}

        {!hasActionableImportPreview && nextIsCompetitor ? (
          <createFetcher.Form className="f9-ed-setup-primary" method="post">
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
            {/* Brief §5: the one Rank-1 on this screen. It is never rendered
                disabled — a washed-out ink fill under a full-strength accent
                offset reads half-built, and the action already answers an empty
                or malformed website with the honest message the card shows
                above (setup-checklist-action.server). */}
            <SubmitButton
              className="f9-ed-cta f9-ed-cta--rank1"
              intent="create-watchlist"
              // A fetcher submit never enters `useNavigation()`, so the pending
              // state has to come from the fetcher itself — otherwise the
              // in-flight treatment fixed in the F2 pass would silently stop
              // firing for this button.
              pending={creatingWatchlist}
              pendingLabel="Starting first scan…"
            >
              Track {normalizedWebsite.displayName ?? "this competitor"}
            </SubmitButton>
            <small
              className="f9-ed-setup-hint"
              data-state={website.trim() && !canSubmitWebsite ? "invalid" : "ok"}
              id="setup-competitor-hint"
            >
              {normalizedWebsite.error ?? "We create the watchlist and start its first scan immediately."}
            </small>
          </createFetcher.Form>
        ) : !hasActionableImportPreview && nextItem.action ? (
          <div className="f9-ed-action-row">
            <PrimaryAction to={nextItem.action.href}>{nextItem.action.label}</PrimaryAction>
          </div>
        ) : null}
        </div>

        {/* Brief §5 Rank-2/Rank-3 foot: the bulk-import disclosure is a real
            Rank-2 control (no native ► marker) and the two low-frequency links
            are a ruled Rank-3 row, not floating underlines. */}
        <div className="f9-ed-setup-foot">
          {hasWatchlistCapacity ? (
            <details className="f9-ed-setup-import" open={Boolean(importPreview) || undefined}>
              <summary className="f9-ed-cta f9-ed-cta--rank2">
                Add several competitors by paste or CSV
              </summary>
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
                <div className="f9-ed-action-row">
                  <SubmitButton
                    className="f9-ed-cta f9-ed-cta--rank2"
                    intent="preview-market-desk-import"
                    name="intent"
                    pendingLabel="Checking…"
                    value="preview-market-desk-import"
                  >
                    Preview import
                  </SubmitButton>
                  {hasActionableImportPreview && importPreview ? (
                    <SubmitButton
                      className="f9-ed-cta f9-ed-cta--rank1"
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
            <p className="f9-ed-setup-capacity">
              Your current plan is at its competitor limit.{" "}
              <TertiaryAction to="/app/billing?source=setup-checklist#plans">
                View plans
              </TertiaryAction>
            </p>
          )}

          <div className="f9-ed-setup-links">
            <TertiaryAction href={website.trim() ? `/search?website=${encodeURIComponent(website.trim())}` : "/search"}>
              Search first instead
            </TertiaryAction>
            <TertiaryAction to="/app/account#brand-profile">Add your brand website</TertiaryAction>
          </div>
        </div>
      </div>
    </section>
  );
}

function ImportPreview({ preview }: { preview: CompetitorImportPreview }) {
  return (
    <section aria-label="Competitor import preview" className="f9-import-preview">
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

function ImportRow({ row }: { row: CompetitorImportRow }) {
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
