import { Form } from "react-router";

import { TertiaryAction } from "~/components/evidence/cta";
import { SubmitButton } from "~/components/submit-button";
import { ImportPreview } from "~/components/setup-checklist-card";
import type { CompetitorImportPreview } from "~/lib/competitor-import";

export interface CompetitorImportFormActionData {
  ok?: boolean;
  message?: string;
  error?: string;
  intent?: string;
  preview?: CompetitorImportPreview;
  rawText?: string;
  brandWebsiteInput?: string;
  upgradePath?: string;
}

export function CompetitorImportForm({
  actionData,
  hasWatchlistCapacity,
  importSurface,
  upgradePath,
}: {
  actionData?: CompetitorImportFormActionData | null;
  hasWatchlistCapacity: boolean;
  importSurface: "watchlists" | "onboarding";
  upgradePath: string;
}) {
  const importPreview = actionData?.preview ?? null;
  const hasActionableImportPreview = Boolean(
    importPreview && importPreview.selectedCount > 0,
  );

  return (
    <details
      className="f9-evidence-setup-import"
      open={Boolean(importPreview) || undefined}
    >
      <summary>Add several competitors by paste or CSV</summary>
      {hasWatchlistCapacity ? (
        <Form encType="multipart/form-data" method="post">
          {importSurface ? (
            <input
              name="importSurface"
              type="hidden"
              value={importSurface}
            />
          ) : null}
          <label className="f9-field">
            <span>Competitors</span>
            <textarea
              defaultValue={actionData?.rawText ?? ""}
              name="competitors"
              placeholder={"competitor.com\nbrand two\nname,website,notes,tags,client"}
              rows={5}
              spellCheck={false}
            />
            <small>
              Paste domains, URLs, names, or CSV rows. Existing competitors and
              plan limits are checked before any write.
            </small>
          </label>
          <label className="f9-field">
            <span>CSV or text file</span>
            <input
              accept=".csv,.txt,text/csv,text/plain"
              name="competitorFile"
              type="file"
            />
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
      ) : (
        <p className="f9-evidence-setup-capacity">
          Your current plan is at its competitor limit.{" "}
          <TertiaryAction to={upgradePath}>View plans</TertiaryAction>
        </p>
      )}
    </details>
  );
}
