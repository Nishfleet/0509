import { useState } from "react";
import { Form, Link } from "react-router";

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
  const setupActionData =
    actionData?.intent && SETUP_ACTION_INTENTS.has(actionData.intent)
      ? actionData
      : undefined;
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
      <header className="f9-ed-setup-header">
        <span className="f9-ed-micro">
          Setup · {readyCount} of {items.length} done
        </span>
        <h2 id="setup-checklist-title">Finish the workspace that sends your first brief</h2>
      </header>

      {setupActionData?.message ? (
        <div
          aria-live={setupActionData.ok ? "polite" : "assertive"}
          className={`f9-message ${setupActionData.ok ? "is-success" : "is-error"}`}
          role={setupActionData.ok ? "status" : "alert"}
        >
          <p>{setupActionData.message}</p>
          {!setupActionData.ok && setupActionData.upgradePath ? (
            <Link to={setupActionData.upgradePath}>View plans</Link>
          ) : null}
        </div>
      ) : null}

      {!hasActionableImportPreview && nextIsCompetitor ? (
        <Form className="f9-ed-setup-primary" method="post">
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
            <small id="setup-competitor-hint">
              {normalizedWebsite.error ?? "We create the watchlist and start its first scan immediately."}
            </small>
          </label>
          <SubmitButton
            className="f9-ed-cta f9-ed-cta--rank1"
            disabled={!canSubmitWebsite}
            intent="create-watchlist"
            pendingLabel="Starting first scan…"
          >
            Track {normalizedWebsite.displayName ?? "this competitor"}
          </SubmitButton>
        </Form>
      ) : !hasActionableImportPreview && nextItem.action ? (
        <div className="f9-ed-action-row">
          <PrimaryAction to={nextItem.action.href}>{nextItem.action.label}</PrimaryAction>
        </div>
      ) : null}

      <ol className="f9-ed-setup-list">
        {items.map((item) => {
          const done = isBlockingSetupItemComplete(readiness, item);
          const isNext = item.id === nextItem.id;
          return (
            <li
              aria-current={isNext ? "step" : undefined}
              className="f9-ed-setup-row"
              data-state={done ? "done" : isNext ? "next" : "pending"}
              key={item.id}
            >
              <span className="f9-ed-setup-stamp">
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
        <details className="f9-ed-setup-import" open={Boolean(importPreview) || undefined}>
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
