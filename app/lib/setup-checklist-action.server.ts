import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { sanitizeCustomerFacingMessage } from "~/lib/customer-route-error";
import {
  hasInvalidCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import {
  normalizeSavedQuery,
} from "~/lib/normalize";
import { ALL_COUNTRIES_VALUE, defaultCountryForVisitor, isoFromCountryName } from "~/lib/countries";
import {
  buildCompetitorImportPreview,
  COMPETITOR_IMPORT_MAX_BYTES,
  type CompetitorImportPreview,
  type CompetitorImportRow,
} from "~/lib/competitor-import";
import type { AppEnv } from "~/lib/env.server";
import {
  queueFirstWatchlistScan,
  queueFirstWatchlistScanForSignupFirstBrief,
} from "~/lib/first-watchlist-scan.server";
import type { ClientRoomRecord, ClientRoomResourceRef } from "~/lib/types";

export async function handleSetupChecklistAction(
  { context, request }: ActionFunctionArgs,
  parsedFormData?: FormData,
) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { completeUserOnboarding, upsertWorkspaceBranding } = await import("~/lib/data.server");
  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);
  const { resolveE2EProviderDeny, sanitizeE2EProviderEnv } = await import("~/lib/e2e-provider.server");
  const providerDeny = await resolveE2EProviderDeny(env, request);
  if (providerDeny.failClosed && !providerDeny.enabled) {
    throw new Response("The local release-proof environment is unavailable.", { status: 503 });
  }
  const scanEnv = providerDeny.enabled ? sanitizeE2EProviderEnv(env) : env;
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  const multipartSizeError = oversizedMultipartImportMessage(request, COMPETITOR_IMPORT_MAX_BYTES);
  if (multipartSizeError) {
    return {
      ok: false,
      intent: "preview-market-desk-import",
      message: multipartSizeError,
      rawText: "",
      brandWebsiteInput: "",
    };
  }

  const formData = parsedFormData ?? await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const importSurface = String(formData.get("importSurface") ?? "onboarding");
  const websiteInput = String(formData.get("website") ?? "").trim();
  const queryInput = String(formData.get("query") ?? "").trim();
  const brandWebsiteInput = String(formData.get("brandWebsite") ?? "").trim();
  const competitorWebsite = normalizeCompetitorWebsiteInput(websiteInput);
  const brandWebsite = normalizeCompetitorWebsiteInput(brandWebsiteInput);
  const query = queryInput || competitorWebsite.searchTerm || "";

  if (!isMember && brandWebsiteInput && hasInvalidCompetitorWebsite(brandWebsite)) {
    return {
      ok: false,
      intent,
      message: brandWebsite.error ?? "Enter a full brand website address.",
    };
  }

  async function saveOptionalBrandWebsite() {
    if (isMember) return;
    if (brandWebsiteInput || formData.has("brandWebsite")) {
      await upsertWorkspaceBranding(env, workspaceUserId, {
        brandWebsite: brandWebsite.normalizedUrl,
      });
    }
  }

  if (intent === "preview-market-desk-import" || intent === "create-market-desk-import") {
    const pastedText = String(formData.get("competitors") ?? "");
    const uploadedFile = formData.get("competitorFile");
    const fileText = await readSmallCompetitorImportFile(uploadedFile, COMPETITOR_IMPORT_MAX_BYTES);
    const rawText = [pastedText.trim(), fileText.text.trim()].filter(Boolean).join("\n");

    if (fileText.error) {
      return {
        ok: false,
        intent,
        message: fileText.error ?? "We couldn't read that import file.",
        rawText: pastedText,
        brandWebsiteInput,
      };
    }

    const watchlistLimit = await checkPlanLimit(env, workspaceUserId, "watchlists");
    if (watchlistLimit.limit < 1) {
      return {
        ok: false,
        intent,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message: "Competitor monitoring isn't included on this plan. Upgrade to create watchlists.",
        upgradePath:
          importSurface === "watchlists"
            ? "/app/billing?source=watchlists#plans"
            : "/app/billing?source=onboarding#plans",
        rawText,
        brandWebsiteInput,
      };
    }

    const visitorCountry = defaultCountryForVisitor(
      cloudflare?.country ??
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

    const { requireVerifiedEmailForRetention, emailUnverifiedActionResult } = await import(
      "~/lib/email-verification.server"
    );
    const verification = await requireVerifiedEmailForRetention(env, workspaceUserId);
    if (!verification.ok) {
      return {
        ...emailUnverifiedActionResult(),
        intent,
        rawText,
        brandWebsiteInput,
      };
    }

    const selectedRejection = selectedImportRejection(preview, selectedRowIds ?? []);
    if (selectedRejection) {
      return {
        ok: false,
        intent,
        error: "import_selection_rejected",
        message: selectedRejection.message,
        preview,
        rawText,
        brandWebsiteInput,
        rejectedRows: selectedRejection.rows,
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
    const contextValidationMessage = await validateCompetitorImportContext(rowsToCreate);
    if (contextValidationMessage) {
      return {
        ok: false,
        intent,
        error: "import_context_rejected",
        message: contextValidationMessage ?? "We couldn't validate that import context.",
        preview,
        rawText,
        brandWebsiteInput,
      };
    }

    const { createWatchlistWithinLimit, upsertAgentMemory, upsertClientRoom } = await import("~/lib/data.server");
    const { isSignupFirstBriefEnabled } = await import("~/lib/env.server");
    const signupFirstBriefEnabled = isSignupFirstBriefEnabled(env);
    const clientRoomContextRequested = rowsToCreate.some((row) => Boolean(row.client));
    let clientRoomEntitled = false;
    if (clientRoomContextRequested) {
      const { getUserPlan } = await import("~/lib/plan.server");
      const { canUsePlanFeature } = await import("~/lib/plan-entitlements");
      clientRoomEntitled = canUsePlanFeature(await getUserPlan(env, workspaceUserId), "client_reports");
    }
    let createdCount = 0;
    const queuedWatchlistIds = new Set<string>();
    const liveRejectedRows: Array<Pick<CompetitorImportRow, "id" | "rowNumber" | "status" | "reason">> = [];
    for (const row of rowsToCreate) {
      if (!row.target) continue;
      const result = await createWatchlistWithinLimit(env, workspaceUserId, row.target, watchlistLimit.limit);
      if (result.status === "over_cap") {
        liveRejectedRows.push({
          id: row.id,
          rowNumber: row.rowNumber,
          status: "over_cap",
          reason: "You hit your plan limit before we could create this row.",
        });
        continue;
      }

      const watchlist = result.watchlist;
      await persistCompetitorImportContext({
        env,
        workspaceUserId,
        row,
        watchlistId: watchlist.id,
        watchlistLabel: watchlist.targetLabel,
        upsertAgentMemory,
        upsertClientRoom: clientRoomEntitled ? upsertClientRoom : undefined,
      });
      if (result.status === "created" && !queuedWatchlistIds.has(watchlist.id)) {
        queuedWatchlistIds.add(watchlist.id);
        createdCount += 1;
        if (signupFirstBriefEnabled) {
          await queueFirstWatchlistScanForSignupFirstBrief(scanEnv, cloudflare?.ctx, watchlist);
        } else {
          await queueFirstWatchlistScan(scanEnv, cloudflare?.ctx, watchlist);
        }
      }
    }

    if (liveRejectedRows.length > 0) {
      return {
        ok: false,
        intent,
        error: "plan_limit_exceeded",
        message: createdCount > 0
          ? `Created ${createdCount} competitor ${createdCount === 1 ? "watchlist" : "watchlists"}, but ${liveRejectedRows.length} selected ${liveRejectedRows.length === 1 ? "row no longer fits" : "rows no longer fit"} your plan. Review the remaining rows.`
          : "Selected competitors no longer fit your current plan. Review the rows or upgrade before creating more watchlists.",
        preview,
        rawText,
        brandWebsiteInput,
        rejectedRows: liveRejectedRows,
        createdCount,
      };
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

    if (signupFirstBriefEnabled) {
      const { emitFunnelActivationScanStarted } = await import(
        "~/lib/funnel-measurement.server"
      );
      emitFunnelActivationScanStarted(env, request);
    }

    if (importSurface === "watchlists") {
      throw redirect(`/app/watchlists?imported=${createdCount}`);
    }

    await saveOptionalBrandWebsite();
    await completeUserOnboarding(env, session.user.id);

    if (signupFirstBriefEnabled) {
      throw redirect(`/app/onboard?step=first-brief`);
    }
    throw redirect(`/app?setup=market-desk&created=${createdCount}`);
  }

  if (intent === "create-handoff-watchlists") {
    return handleCreateHandoffWatchlists({
      env,
      scanEnv,
      cloudflare,
      request,
      session,
      workspaceUserId,
      formData,
      saveOptionalBrandWebsite,
    });
  }

  if (intent === "create-watchlist") {
    if (hasInvalidCompetitorWebsite(competitorWebsite)) {
      return {
        ok: false,
        intent,
        message: competitorWebsite.error ?? "Enter a full competitor website address.",
      };
    }

    if (!query) {
      return {
        ok: false,
        intent,
        message: "Enter a full website address first, like brand.com.",
      };
    }

    const { requireVerifiedEmailForRetention, emailUnverifiedActionResult } = await import(
      "~/lib/email-verification.server"
    );
    const verification = await requireVerifiedEmailForRetention(env, workspaceUserId);
    if (!verification.ok) {
      return {
        ...emailUnverifiedActionResult(),
        intent,
      };
    }

    const watchlistLimit = await checkPlanLimit(env, workspaceUserId, "watchlists");

    const visitorCountry = defaultCountryForVisitor(
      cloudflare?.country ??
        request.headers.get("cf-ipcountry"),
    );
    // D11: honor the country the visitor had selected in search when they were
    // handed off to onboarding. Only a recognized, specific country overrides
    // the geo default — an unknown value or "all" falls back to geo so we never
    // persist a nonsense scan country.
    const requestedCountry = String(formData.get("country") ?? "").trim();
    const country =
      requestedCountry &&
      requestedCountry.toLowerCase() !== ALL_COUNTRIES_VALUE &&
      isoFromCountryName(requestedCountry)
        ? requestedCountry
        : visitorCountry;
    const normalizedQuery = normalizeSavedQuery("advertiser", {
      query,
      country,
    });
    const targetFingerprint = watchlistFingerprint(normalizedQuery, competitorWebsite);
    const targetLabel = competitorWebsite.displayName ?? competitorWebsite.searchTerm ?? query;
    const { createWatchlistWithinLimit } = await import("~/lib/data.server");
    const watchlistResult = await createWatchlistWithinLimit(env, workspaceUserId, {
      name: `${competitorWebsite.displayName ?? query} watch`,
      targetType: "advertiser",
      targetId: competitorWebsite.normalizedUrl || query,
      targetFingerprint,
      targetLabel,
      targetCountry: normalizedQuery.filters.country,
      trackingRole: "competitor",
    }, watchlistLimit.limit);

    if (watchlistResult.status === "over_cap") {
      return {
        ok: false,
        intent,
        error: "plan_limit_exceeded",
        limit: watchlistResult.limit,
        current: watchlistResult.current,
        message:
          watchlistResult.limit <= 1
            ? "Free includes 1 watchlist, 1 Collection, and a weekly proof-backed brief. Upgrade for more competitors, scheduled scans, and digests."
            : "You've reached your competitor monitoring limit.",
        upgradePath: "/app/billing?source=onboarding#plans",
      };
    }

    const { isSignupFirstBriefEnabled } = await import("~/lib/env.server");
    const signupFirstBriefEnabled = isSignupFirstBriefEnabled(env);
    const watchlist = watchlistResult.watchlist;
    const queueActivationScan = async () => {
      if (signupFirstBriefEnabled) {
        await queueFirstWatchlistScanForSignupFirstBrief(
          scanEnv,
          cloudflare?.ctx,
          watchlist,
        );
        const { emitFunnelActivationScanStarted } = await import(
          "~/lib/funnel-measurement.server"
        );
        emitFunnelActivationScanStarted(env, request);
      } else {
        await queueFirstWatchlistScan(scanEnv, cloudflare?.ctx, watchlist);
      }
    };
    try {
      await queueActivationScan();
    } catch {
      // Issue #2138: retry the same safe scan once inline before showing
      // "Try again". The retry goes through the same queue path, so the
      // existing in-flight guard in prepareFirstWatchlistScanRun and the
      // execution-key idempotency in ensureOrchestratedWatchlistRun still
      // apply — one watchlist never gets two concurrent scans, and a retry
      // after a partially queued first attempt re-dispatches that same run
      // instead of creating a second one.
      try {
        await queueActivationScan();
      } catch {
        return {
          ok: false,
          intent,
          error: "first_scan_dispatch_delayed",
          message:
            "Competitor saved, but the activation scan hit a delay. Try again to retry the same safe scan.",
        };
      }
    }

    await saveOptionalBrandWebsite();
    await completeUserOnboarding(env, session.user.id);

    if (signupFirstBriefEnabled) {
      throw redirect(`/app/onboard?step=first-brief`);
    }
    throw redirect(watchlist ? `/app/watchlists?watchlist=${watchlist.id}` : "/app/watchlists");
  }

  if (intent === "finish") {
    await saveOptionalBrandWebsite();
    await completeUserOnboarding(env, session.user.id);
    throw redirect("/app");
  }

  return {
    ok: false,
    intent,
    message: "We couldn't complete that action. Refresh the page and try again.",
  };
}

/**
 * Issue #2174 — "create-handoff-watchlists".
 *
 * One click from the setup checklist confirms every competitor a visitor
 * picked on the logged-out /search page (carried here by the signed handoff
 * token). The action:
 *
 *   1. Re-reads the candidates from the form (the same set the token carried;
 *      the token itself is validated on load).
 *   2. Creates each watchlist within the current plan cap, deduping against
 *      existing watchlists — a candidate that already fits or already exists
 *      is never double-created.
 *   3. Triggers the first proof capture for each newly created watchlist
 *      through the existing queue primitives (idempotent per watchlist: the
 *      in-flight guard + execution-key idempotency mean one watchlist never
 *      gets two concurrent scans).
 *   4. Completes onboarding and routes to the same-session first brief so
 *      the first email fires as soon as the first capture completes.
 */
async function handleCreateHandoffWatchlists(input: {
  env: AppEnv;
  scanEnv: AppEnv;
  cloudflare: ReturnType<typeof import("~/lib/cloudflare-context").getOptionalCloudflareContext>;
  request: Request;
  session: { user: { id: string } };
  workspaceUserId: string;
  formData: FormData;
  saveOptionalBrandWebsite: () => Promise<void>;
}) {
  const { env, scanEnv, cloudflare, request, session, workspaceUserId, formData, saveOptionalBrandWebsite } =
    input;
  const {
    requireVerifiedEmailForRetention,
    emailUnverifiedActionResult,
  } = await import("~/lib/email-verification.server");
  const verification = await requireVerifiedEmailForRetention(env, workspaceUserId);
  if (!verification.ok) {
    return {
      ...emailUnverifiedActionResult(),
      intent: "create-handoff-watchlists",
    };
  }

  const candidates = parseHandoffCandidates(formData.getAll("candidate"));
  if (candidates.length === 0) {
    return {
      ok: false,
      intent: "create-handoff-watchlists",
      message: "No competitors were carried from your search. Add a competitor below.",
    };
  }

  const { checkPlanLimit } = await import("~/lib/plan.server");
  const watchlistLimit = await checkPlanLimit(env, workspaceUserId, "watchlists");
  if (watchlistLimit.limit < 1) {
    return {
      ok: false,
      intent: "create-handoff-watchlists",
      error: "plan_limit_exceeded",
      limit: watchlistLimit.limit,
      current: watchlistLimit.current,
      message: "Competitor monitoring isn't included on this plan. Upgrade to create watchlists.",
      upgradePath: "/app/billing?source=onboarding#plans",
    };
  }

  const {
    createWatchlistWithinLimit,
    completeUserOnboarding,
  } = await import("~/lib/data.server");
  const { isSignupFirstBriefEnabled } = await import("~/lib/env.server");
  const { defaultCountryForVisitor } = await import("~/lib/countries");
  const signupFirstBriefEnabled = isSignupFirstBriefEnabled(env);

  const visitorCountry = defaultCountryForVisitor(
    cloudflare?.country ?? request.headers.get("cf-ipcountry"),
  );
  const requestedCountry = String(formData.get("country") ?? "").trim();
  const country =
    requestedCountry &&
    requestedCountry.toLowerCase() !== ALL_COUNTRIES_VALUE &&
    isoFromCountryName(requestedCountry)
      ? requestedCountry
      : visitorCountry;

  let createdCount = 0;
  let existingCount = 0;
  const queued = new Set<string>();
  const rejected: Array<{ advertiser: string; reason: string }> = [];
  for (const candidate of candidates) {
    const website = candidate.landingPageUrl || candidate.advertiser;
    const competitorWebsite = normalizeCompetitorWebsiteInput(website);
    if (hasInvalidCompetitorWebsite(competitorWebsite) && !candidate.landingPageUrl) {
      rejected.push({
        advertiser: candidate.advertiser,
        reason: "could not resolve its website",
      });
      continue;
    }
    const normalizedQuery = normalizeSavedQuery("advertiser", {
      query: competitorWebsite.searchTerm || candidate.advertiser,
      country,
    });
    const targetFingerprint = watchlistFingerprint(normalizedQuery, competitorWebsite);
    // `createWatchlistWithinLimit` dedupes against existing watchlists by
    // fingerprint and enforces the plan cap atomically — a candidate that is
    // already watched returns `existing` (never double-created, never a second
    // scan), and an over-cap candidate returns `over_cap`. We rely on that
    // single source of truth rather than re-deriving fingerprints here.
    const result = await createWatchlistWithinLimit(env, workspaceUserId, {
      name: `${competitorWebsite.displayName ?? candidate.advertiser} watch`,
      targetType: "advertiser" as const,
      targetId: competitorWebsite.normalizedUrl || competitorWebsite.searchTerm || candidate.advertiser,
      targetFingerprint,
      targetLabel: competitorWebsite.displayName ?? candidate.advertiser,
      targetCountry: normalizedQuery.filters.country,
      trackingRole: "competitor" as const,
    }, watchlistLimit.limit);
    if (result.status === "over_cap") {
      rejected.push({
        advertiser: candidate.advertiser,
        reason: "hit your plan limit",
      });
      continue;
    }
    if (result.status === "existing") {
      // Already watched — never double-create, never a second scan.
      existingCount += 1;
      continue;
    }
    if (result.status === "created" && !queued.has(result.watchlist.id)) {
      queued.add(result.watchlist.id);
      createdCount += 1;
      if (signupFirstBriefEnabled) {
        await queueFirstWatchlistScanForSignupFirstBrief(scanEnv, cloudflare?.ctx, result.watchlist);
      } else {
        await queueFirstWatchlistScan(scanEnv, cloudflare?.ctx, result.watchlist);
      }
    }
  }

  if (createdCount === 0 && rejected.length > 0) {
    const allPlanCap = rejected.every((entry) => entry.reason === "hit your plan limit");
    if (allPlanCap) {
      return {
        ok: false,
        intent: "create-handoff-watchlists",
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message:
          watchlistLimit.limit <= 1
            ? "Free includes 1 watchlist, 1 Collection, and a weekly proof-backed brief. Upgrade for more competitors, scheduled scans, and digests."
            : "You've reached your competitor monitoring limit.",
        upgradePath: "/app/billing?source=onboarding#plans",
      };
    }
    return {
      ok: false,
      intent: "create-handoff-watchlists",
      message:
        rejected.length === 1
          ? `We couldn't create ${rejected[0].advertiser}: ${rejected[0].reason} (they may already be watched or exceed your plan).`
          : `${rejected.length} competitors couldn't be created (plan limit or already watched).`,
    };
  }

  if (createdCount === 0) {
    if (existingCount > 0 && rejected.length === 0) {
      // Every picked competitor is already watched — nothing to create, but
      // the visitor's intent is satisfied. Complete onboarding and route to
      // the first brief / dashboard rather than showing an error.
      await saveOptionalBrandWebsite();
      await completeUserOnboarding(env, session.user.id);
      if (signupFirstBriefEnabled) {
        throw redirect(`/app/onboard?step=first-brief`);
      }
      throw redirect(`/app?setup=watchlist&created=0`);
    }
    return {
      ok: false,
      intent: "create-handoff-watchlists",
      message: "Those competitors are already being tracked. Add a new competitor or pick a different set.",
    };
  }

  if (signupFirstBriefEnabled) {
    const { emitFunnelActivationScanStarted } = await import("~/lib/funnel-measurement.server");
    emitFunnelActivationScanStarted(env, request);
  }

  await saveOptionalBrandWebsite();
  await completeUserOnboarding(env, session.user.id);

  if (signupFirstBriefEnabled) {
    throw redirect(`/app/onboard?step=first-brief`);
  }
  throw redirect(`/app?setup=watchlist&created=${createdCount}`);
}

function parseHandoffCandidates(values: FormDataEntryValue[]): Array<{
  advertiser: string;
  pageId: string | null;
  landingPageUrl: string | null;
  targetCountry: string | null;
}> {
  const out: Array<{
    advertiser: string;
    pageId: string | null;
    landingPageUrl: string | null;
    targetCountry: string | null;
  }> = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (typeof parsed.advertiser !== "string" || !parsed.advertiser.trim()) continue;
      out.push({
        advertiser: parsed.advertiser,
        pageId: typeof parsed.pageId === "string" ? parsed.pageId : null,
        landingPageUrl: typeof parsed.landingPageUrl === "string" ? parsed.landingPageUrl : null,
        targetCountry: typeof parsed.targetCountry === "string" ? parsed.targetCountry : null,
      });
    } catch {
      // A malformed candidate row is skipped — never a hard failure.
    }
  }
  return out;
}


export function oversizedMultipartImportMessage(request: Request, maxBytes: number) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return null;
  }

  const contentLength = Number(request.headers.get("content-length"));
  const multipartOverheadAllowance = 32_768;
  if (!Number.isFinite(contentLength) || contentLength <= maxBytes + multipartOverheadAllowance) {
    return null;
  }

  return `Import is too large. Paste or upload ${Math.floor(maxBytes / 1024)} KB or less.`;
}

function selectedImportRejection(preview: CompetitorImportPreview, selectedRowIds: readonly string[]) {
  const selectedIds = Array.from(new Set(selectedRowIds.filter(Boolean)));
  if (selectedIds.length === 0) {
    return null;
  }

  const rowsById = new Map(preview.rows.map((row) => [row.id, row]));
  const rows = selectedIds
    .map((id) => {
      const row = rowsById.get(id);
      if (!row) {
        return {
          id,
          rowNumber: 0,
          status: "invalid" as const,
          reason: "Selected row was not found. Preview the import again.",
        };
      }
      if (row.selected && row.status === "valid" && row.target) {
        return null;
      }
      return {
        id: row.id,
        rowNumber: row.rowNumber,
        status: row.status,
        reason: row.reason ?? "This row isn't ready to create yet.",
      };
    })
    .filter((row): row is {
      id: string;
      rowNumber: number;
      status: CompetitorImportRow["status"];
      reason: string;
    } => Boolean(row));

  if (rows.length === 0) {
    return null;
  }

  return {
    rows,
    message: rows.length === 1
      ? `Row ${rows[0].rowNumber || rows[0].id} cannot be created: ${rows[0].reason}`
      : `${rows.length} selected rows cannot be created. Review the preview and select only ready competitors within your plan limit.`,
  };
}

async function validateCompetitorImportContext(rows: CompetitorImportRow[]) {
  const { AgentMemoryInputError, rejectSecretishMemoryValue } = await import("~/lib/agent-memory.server");
  for (const row of rows) {
    if (!hasCompetitorImportContext(row)) {
      continue;
    }

    try {
      rejectSecretishMemoryValue(
        competitorImportContextValue(row, row.target?.targetLabel ?? row.name ?? row.website ?? row.raw),
        "Imported competitor notes, tags, and client labels cannot contain secrets or credentials.",
      );
    } catch (error) {
      if (error instanceof AgentMemoryInputError || error instanceof Error) {
        return sanitizeCustomerFacingMessage(error.message);
      }
      return "Imported competitor notes, tags, and client labels cannot contain secrets or credentials.";
    }
  }

  return null;
}

async function persistCompetitorImportContext(input: {
  env: AppEnv;
  workspaceUserId: string;
  row: CompetitorImportRow;
  watchlistId: string;
  watchlistLabel: string;
  upsertAgentMemory: typeof import("~/lib/data.server").upsertAgentMemory;
  upsertClientRoom?: typeof import("~/lib/data.server").upsertClientRoom;
}) {
  if (!hasCompetitorImportContext(input.row)) {
    return;
  }

  const value = competitorImportContextValue(input.row, input.watchlistLabel);
  if (input.row.notes || input.row.tags.length > 0) {
    await input.upsertAgentMemory(input.env, input.workspaceUserId, {
      scope: "competitor",
      key: "import_context",
      watchlistId: input.watchlistId,
      value,
      source: "market_desk_import",
    });
  }

  if (!input.row.client || !input.upsertClientRoom) {
    return;
  }

  const room = await input.upsertClientRoom(input.env, input.workspaceUserId, {
    name: `${input.row.client} watch`,
    clientLabel: input.row.client,
  });
  if (!room) {
    return;
  }

  await input.upsertClientRoom(input.env, input.workspaceUserId, {
    roomId: room.id,
    name: room.name,
    clientLabel: room.clientLabel ?? input.row.client,
    status: room.status,
    resourceRefs: mergeClientRoomWatchlistRef(room, {
      resourceType: "watchlist",
      resourceId: input.watchlistId,
      label: input.watchlistLabel,
    }),
    notes: {
      ...room.notes,
      marketDeskImport: {
        source: "onboarding",
        importedGrouping: true,
      },
    },
  });
}

function hasCompetitorImportContext(row: CompetitorImportRow) {
  return Boolean(row.notes || row.tags.length > 0 || row.client);
}

function competitorImportContextValue(row: CompetitorImportRow, watchlistLabel: string) {
  return {
    competitor: watchlistLabel,
    importedFrom: "market_desk_onboarding",
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.tags.length > 0 ? { tags: row.tags } : {}),
    ...(row.client ? { client: row.client } : {}),
  };
}

function mergeClientRoomWatchlistRef(room: ClientRoomRecord, ref: ClientRoomResourceRef) {
  const existing = room.resourceRefs.filter((candidate) =>
    !(candidate.resourceType === ref.resourceType && candidate.resourceId === ref.resourceId)
  );
  return [...existing, ref];
}

export function importPreviewMessage(preview: CompetitorImportPreview) {
  if (preview.error) return preview.error;
  if (preview.selectedCount > 0) {
    return `Ready to create ${preview.selectedCount} competitor ${preview.selectedCount === 1 ? "watchlist" : "watchlists"}.`;
  }
  if (preview.availableSlots === 0) {
    return "Preview ready, but your current plan has no open competitor slots.";
  }
  return "Preview ready. Select at least one competitor to continue.";
}

async function readSmallCompetitorImportFile(value: FormDataEntryValue | null, maxBytes: number) {
  if (!isUploadedFile(value) || value.size === 0) return { text: "", error: null };
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

export function hasImportPreview(value: unknown): value is {
  preview: CompetitorImportPreview;
  rawText: string;
  brandWebsiteInput: string;
} {
  return Boolean(value && typeof value === "object" && "preview" in value);
}
