import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { SubmitButton } from "~/components/submit-button";
import {
  hasInvalidCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import {
  normalizeSavedQuery,
} from "~/lib/normalize";
import { defaultCountryForVisitor } from "~/lib/countries";
import type { CompetitorImportPreview, CompetitorImportRow } from "~/lib/competitor-import";

export const meta: MetaFunction = () => [
  { title: "Set up your account | Five to Nine" },
  {
    name: "description",
    content: "Choose a competitor to track so your Five to Nine account starts with a concrete next step.",
  },
];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Get started" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getWorkspaceBranding } = await import("~/lib/data.server");
  const { checkPlanLimit, getUserPlan } = await import("~/lib/plan.server");
  const env = getEnv(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  const url = new URL(request.url);
  const resumeSetup = url.searchParams.get("resume") === "1";

  if (isMember) {
    const { completeUserOnboarding } = await import("~/lib/data.server");
    await completeUserOnboarding(env, session.user.id);
    throw redirect("/app");
  }

  if (session.user.onboardedAt && !resumeSetup) {
    throw redirect("/app");
  }

  const [plan, watchlistLimit, branding] = await Promise.all([
    getUserPlan(env, workspaceUserId),
    checkPlanLimit(env, workspaceUserId, "watchlists"),
    getWorkspaceBranding(env, workspaceUserId),
  ]);

  return {
    session,
    plan,
    watchlistLimit,
    brandWebsite: branding.brandWebsite,
    resumeSetup,
    visitorCountry: defaultCountryForVisitor(
      (context.cloudflare as { country?: string | null } | undefined)?.country ??
        request.headers.get("cf-ipcountry"),
    ),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { completeUserOnboarding, createWatchlist, upsertWorkspaceBranding } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);

  if (isMember) {
    const { completeUserOnboarding } = await import("~/lib/data.server");
    await completeUserOnboarding(env, session.user.id);
    throw redirect("/app");
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const websiteInput = String(formData.get("website") ?? "").trim();
  const queryInput = String(formData.get("query") ?? "").trim();
  const brandWebsiteInput = String(formData.get("brandWebsite") ?? "").trim();
  const competitorWebsite = normalizeCompetitorWebsiteInput(websiteInput);
  const brandWebsite = normalizeCompetitorWebsiteInput(brandWebsiteInput);
  const query = queryInput || competitorWebsite.searchTerm || "";

  if (brandWebsiteInput && hasInvalidCompetitorWebsite(brandWebsite)) {
    return {
      ok: false,
      message: brandWebsite.error,
    };
  }

  async function saveOptionalBrandWebsite() {
    if (brandWebsiteInput || formData.has("brandWebsite")) {
      await upsertWorkspaceBranding(env, workspaceUserId, {
        brandWebsite: brandWebsite.normalizedUrl,
      });
    }
  }

  if (intent === "preview-market-desk-import" || intent === "create-market-desk-import") {
    const { buildCompetitorImportPreview, COMPETITOR_IMPORT_MAX_BYTES } = await import("~/lib/competitor-import");
    const pastedText = String(formData.get("competitors") ?? "");
    const uploadedFile = formData.get("competitorFile");
    const fileText = await readSmallCompetitorImportFile(uploadedFile, COMPETITOR_IMPORT_MAX_BYTES);
    const rawText = [pastedText.trim(), fileText.text.trim()].filter(Boolean).join("\n");

    if (fileText.error) {
      return {
        ok: false,
        intent,
        message: fileText.error,
        rawText: pastedText,
        brandWebsiteInput,
      };
    }

    const watchlistLimit = await checkPlanLimit(env, workspaceUserId, "watchlists");
    const isZeroLimit = watchlistLimit.limit === 0;
    if (isZeroLimit) {
      return {
        ok: false,
        intent,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message:
          "Competitor monitoring is available on paid plans. Starter is the recommended plan for daily tracking and daily/weekly digests.",
        upgradePath: "/#pricing",
        rawText,
        brandWebsiteInput,
      };
    }

    const visitorCountry = defaultCountryForVisitor(
      (context.cloudflare as { country?: string | null } | undefined)?.country ??
        request.headers.get("cf-ipcountry"),
    );
    const { listWatchlists } = await import("~/lib/data.server");
    const watchlists = await listWatchlists(env, workspaceUserId, { includeInactive: true });
    const existingFingerprints = watchlists
      .filter((watchlist) => watchlist.isActive)
      .map((watchlist) => watchlist.targetFingerprint);
    const selectedRowIds = intent === "create-market-desk-import"
      ? formData.getAll("selectedRowIds").map((value) => String(value))
      : null;
    const preview = buildCompetitorImportPreview({
      rawText,
      country: visitorCountry,
      planLimit: watchlistLimit.limit,
      currentCount: watchlistLimit.current,
      existingFingerprints,
      selectedRowIds,
    });

    if (intent === "preview-market-desk-import") {
      return {
        ok: preview.error === null && preview.selectedCount > 0,
        intent,
        message: importPreviewMessage(preview),
        preview,
        rawText,
        brandWebsiteInput,
      };
    }

    if (preview.error || preview.selectedCount === 0) {
      return {
        ok: false,
        intent,
        message: preview.error ?? "Select at least one ready competitor within your current plan limit.",
        preview,
        rawText,
        brandWebsiteInput,
      };
    }

    const rowsToCreate = preview.rows.filter((row) => row.selected && row.status === "valid" && row.target);
    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    let createdCount = 0;
    const queuedWatchlistIds = new Set<string>();
    for (const row of rowsToCreate) {
      if (!row.target) continue;
      const watchlist = await createWatchlist(env, workspaceUserId, row.target);
      if (watchlist && !queuedWatchlistIds.has(watchlist.id)) {
        queuedWatchlistIds.add(watchlist.id);
        createdCount += 1;
        queueFirstWatchlistScan(env, context.cloudflare?.ctx, watchlist);
      }
    }

    if (createdCount === 0) {
      return {
        ok: false,
        intent,
        message: "Those competitors are already being tracked. Add a new competitor or choose a different row.",
        preview,
        rawText,
        brandWebsiteInput,
      };
    }

    await saveOptionalBrandWebsite();
    await completeUserOnboarding(env, session.user.id);

    throw redirect(`/app?setup=market-desk&created=${createdCount}`);
  }

  if (intent === "create-watchlist") {
    if (hasInvalidCompetitorWebsite(competitorWebsite)) {
      return {
        ok: false,
        message: competitorWebsite.error,
      };
    }

    if (!query) {
      return {
        ok: false,
        message: "Enter a full website address first, like brand.com.",
      };
    }

    const watchlistLimit = await checkPlanLimit(env, workspaceUserId, "watchlists");
    if (!watchlistLimit.allowed) {
      const isZeroLimit = watchlistLimit.limit === 0;

      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message: isZeroLimit
          ? "Competitor monitoring is available on paid plans. Starter is the recommended plan for daily tracking and daily/weekly digests."
          : "You have reached your competitor monitoring limit.",
        upgradePath: "/#pricing",
      };
    }

    const visitorCountry = defaultCountryForVisitor(
      (context.cloudflare as { country?: string | null } | undefined)?.country ??
        request.headers.get("cf-ipcountry"),
    );
    const normalizedQuery = normalizeSavedQuery("advertiser", {
      query,
      country: visitorCountry,
    });
    const targetFingerprint = watchlistFingerprint(normalizedQuery, competitorWebsite);
    const targetLabel = competitorWebsite.displayName ?? competitorWebsite.searchTerm ?? query;
    const watchlist = await createWatchlist(env, workspaceUserId, {
      name: `${competitorWebsite.displayName ?? query} watch`,
      targetType: "advertiser",
      targetId: competitorWebsite.normalizedUrl || query,
      targetFingerprint,
      targetLabel,
      targetCountry: normalizedQuery.filters.country,
      trackingRole: "competitor",
    });

    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    queueFirstWatchlistScan(env, context.cloudflare?.ctx, watchlist);

    await saveOptionalBrandWebsite();
    await completeUserOnboarding(env, session.user.id);

    throw redirect(watchlist ? `/app/watchlists?watchlist=${watchlist.id}` : "/app/watchlists");
  }

  if (intent === "finish") {
    await saveOptionalBrandWebsite();
    await completeUserOnboarding(env, session.user.id);
    throw redirect("/app");
  }

  return {
    ok: false,
    message: "Unknown onboarding action.",
  };
}

export default function AppOnboardRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const importActionData = hasImportPreview(actionData) ? actionData : null;
  const importPreview = importActionData?.preview ?? null;
  const [website, setWebsite] = useState("");
  const [brandWebsite, setBrandWebsite] = useState(importActionData?.brandWebsiteInput ?? data.brandWebsite ?? "");
  const trimmedWebsite = website.trim();
  const trimmedBrandWebsite = brandWebsite.trim();
  const competitorWebsite = normalizeCompetitorWebsiteInput(trimmedWebsite);
  const ownBrandWebsite = normalizeCompetitorWebsiteInput(trimmedBrandWebsite);
  const competitorQuery = competitorWebsite.searchTerm ?? "";
  const canCreateWatchlist = data.watchlistLimit.allowed && data.watchlistLimit.limit > 0;

  return (
    <DashboardPage>
      <main className="f9-onboard-page">
      <div className="f9-auth-gradient" aria-hidden="true" />
      <section className="f9-container f9-onboard-layout">
        <article className="f9-onboard-card">
          <DashboardPageHeader
            lead={data.resumeSetup
              ? "Paste another set of competitors. Five to Nine validates them, creates watchlists, and queues the first Market Desk scan."
              : "Paste competitors once. Five to Nine validates them, creates watchlists, and queues the first Market Desk scan."}
            title={data.resumeSetup ? "Resume setup" : "Get started"}
          />

          {actionData?.message ? (
            <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
              <p>{actionData.message}</p>
              {!actionData.ok && "upgradePath" in actionData && actionData.upgradePath ? (
                <Link className="f9-text-link" to={actionData.upgradePath}>
                  View pricing
                </Link>
              ) : null}
            </div>
          ) : null}

          {canCreateWatchlist ? (
            <Form className="f9-auth-form f9-onboard-import-form" encType="multipart/form-data" method="post">
              <label className="f9-field">
                <span>Competitors</span>
                <textarea
                  defaultValue={importActionData?.rawText ?? ""}
                  name="competitors"
                  placeholder={"competitor.com\nbrand two\nname,website,notes"}
                  rows={7}
                  spellCheck={false}
                />
                <small>Paste domains, URLs, names, or a CSV with name and website columns.</small>
              </label>

              <label className="f9-field">
                <span>CSV or text file</span>
                <input accept=".csv,.txt,text/csv,text/plain" name="competitorFile" type="file" />
                <small>Use a small file when copy-paste is not practical.</small>
              </label>

              <details className="f9-inline-details">
                <summary>Optional: add your brand website</summary>
                <label className="f9-field">
                  <span>My brand website</span>
                  <input
                    autoComplete="url"
                    inputMode="url"
                    name="brandWebsite"
                    onChange={(event) => setBrandWebsite(event.currentTarget.value)}
                    placeholder="https://yourbrand.com"
                    spellCheck={false}
                    value={brandWebsite}
                  />
                  {ownBrandWebsite.error ? <small>{ownBrandWebsite.error}</small> : null}
                </label>
              </details>

              {importPreview ? <ImportPreviewPanel preview={importPreview} /> : null}

              <div className="f9-action-row">
                <SubmitButton
                  className="f9-secondary-button"
                  intent="preview-market-desk-import"
                  name="intent"
                  pendingLabel="Checking..."
                  value="preview-market-desk-import"
                >
                  Preview import
                </SubmitButton>
                {importPreview ? (
                  <SubmitButton
                    className="f9-primary-button"
                    disabled={importPreview.selectedCount === 0}
                    intent="create-market-desk-import"
                    name="intent"
                    pendingLabel="Creating..."
                    value="create-market-desk-import"
                  >
                    Create {importPreview.selectedCount || ""} watchlists
                  </SubmitButton>
                ) : null}
              </div>

              <p className="f9-muted-copy">
                First scans start right after setup, then the dashboard turns them into a Market Desk Brief.
              </p>
            </Form>
          ) : (
            <section className="f9-onboard-step">
              <span className="f9-app-kicker">Plan required</span>
              <h2>Choose a plan to start monitoring</h2>
              <p className="f9-muted-copy">
                Starter is the recommended plan for retained competitor tracking with daily scans and daily/weekly digests.
              </p>
              <div className="f9-action-row">
                <Link className="f9-primary-button" to="/#pricing">
                  View plans
                </Link>
                <span className="f9-muted-copy">Current plan: {data.plan}</span>
              </div>
            </section>
          )}

          {canCreateWatchlist ? (
            <details className="f9-inline-details">
              <summary>Track one competitor instead</summary>
              <Form className="f9-auth-form f9-onboard-single-form" method="post">
                <input name="intent" type="hidden" value="create-watchlist" />
              <label className="f9-field">
                <span>Competitor website</span>
                <input
                  autoComplete="url"
                  inputMode="url"
                  name="website"
                  onChange={(event) => setWebsite(event.currentTarget.value)}
                  placeholder="https://competitor.com"
                  spellCheck={false}
                  value={website}
                />
                {competitorWebsite.error ? <small>{competitorWebsite.error}</small> : null}
              </label>

              <details className="f9-inline-details">
                <summary>Optional: add your brand website</summary>
                <label className="f9-field">
                  <span>My brand website</span>
                  <input
                    autoComplete="url"
                    inputMode="url"
                    name="brandWebsite"
                    onChange={(event) => setBrandWebsite(event.currentTarget.value)}
                    placeholder="https://yourbrand.com"
                    spellCheck={false}
                    value={brandWebsite}
                  />
                  {ownBrandWebsite.error ? <small>{ownBrandWebsite.error}</small> : null}
                </label>
              </details>

              <SubmitButton
                className="f9-primary-button"
                disabled={!trimmedWebsite}
                intent="create-watchlist"
                pendingLabel="Creating…"
              >
                Start tracking {competitorWebsite.displayName ?? (competitorQuery || "this competitor")}
              </SubmitButton>
            </Form>
            </details>
          ) : null}

          <div className="f9-onboard-actions">
            <Form method="post">
              <input name="intent" type="hidden" value="finish" />
              <input name="brandWebsite" type="hidden" value={trimmedBrandWebsite} />
              <SubmitButton className="f9-secondary-button" intent="finish" pendingLabel="Working…">
                {data.resumeSetup ? "Back to dashboard" : "Skip for now"}
              </SubmitButton>
            </Form>
            <Link className="f9-text-link" to="/search">
              Search first instead
            </Link>
          </div>
        </article>
      </section>
      </main>
    </DashboardPage>
  );
}

function importPreviewMessage(preview: CompetitorImportPreview) {
  if (preview.error) {
    return preview.error;
  }
  if (preview.selectedCount > 0) {
    return `Ready to create ${preview.selectedCount} competitor ${preview.selectedCount === 1 ? "watchlist" : "watchlists"}.`;
  }
  if (preview.availableSlots === 0) {
    return "Preview ready, but your current plan has no open competitor slots.";
  }
  return "Preview ready. Select at least one competitor to continue.";
}

async function readSmallCompetitorImportFile(value: FormDataEntryValue | null, maxBytes: number) {
  if (!isUploadedFile(value) || value.size === 0) {
    return { text: "", error: null };
  }
  if (value.size > maxBytes) {
    return {
      text: "",
      error: `Import is too large. Paste or upload ${Math.floor(maxBytes / 1024)} KB or less.`,
    };
  }
  return { text: await value.text(), error: null };
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value === "string") return false;
  if (typeof File !== "undefined") return value instanceof File;
  return "size" in value && "text" in value;
}

function hasImportPreview(value: unknown): value is {
  preview: CompetitorImportPreview;
  rawText: string;
  brandWebsiteInput: string;
} {
  return Boolean(value && typeof value === "object" && "preview" in value);
}

function ImportPreviewPanel({ preview }: { preview: CompetitorImportPreview }) {
  return (
    <section className="f9-import-preview" aria-label="Competitor import preview">
      <div className="f9-import-summary" aria-label="Import summary">
        <span>{preview.summary.valid} ready</span>
        <span>{preview.summary.over_cap} over plan</span>
        <span>{preview.summary.duplicate + preview.summary.existing} already covered</span>
        <span>{preview.summary.invalid} needs edit</span>
      </div>
      <div className="f9-import-table">
        {preview.rows.map((row) => (
          <ImportPreviewRow key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}

function ImportPreviewRow({ row }: { row: CompetitorImportRow }) {
  const disabled = row.status === "invalid" || row.status === "duplicate" || row.status === "existing";
  return (
    <label className={`f9-import-row is-${row.status}`}>
      <input
        defaultChecked={row.selected}
        disabled={disabled}
        name="selectedRowIds"
        type="checkbox"
        value={row.id}
      />
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
