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
    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
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
        await queueFirstWatchlistScan(scanEnv, cloudflare?.ctx, watchlist);
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

    if (importSurface === "watchlists") {
      throw redirect(`/app/watchlists?imported=${createdCount}`);
    }

    await saveOptionalBrandWebsite();
    await completeUserOnboarding(env, session.user.id);

    throw redirect(`/app?setup=market-desk&created=${createdCount}`);
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

    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    const watchlist = watchlistResult.watchlist;
    try {
      await queueFirstWatchlistScan(scanEnv, cloudflare?.ctx, watchlist);
    } catch {
      return {
        ok: false,
        intent,
        error: "first_scan_dispatch_delayed",
        message:
          "Competitor saved, but the activation scan hit a delay. Try again to retry the same safe scan.",
      };
    }

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
    intent,
    message: "We couldn't complete that action. Refresh the page and try again.",
  };
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
