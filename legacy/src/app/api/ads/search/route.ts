/**
 * GET /api/ads/search
 *
 * Proxy to Meta Ad Library API. Returns AdRecord[] normalized from Meta's
 * ads_archive endpoint. Falls back to demo data when META_ACCESS_TOKEN is
 * not configured.
 *
 * Query params:
 *   q            — search query (advertiser name or keyword)
 *   mode         — "advertiser" | "keyword" (default: "keyword")
 *   country      — country label or "all" (default: "all")
 *   platform     — "Facebook" | "Instagram" | "Messenger" | "all"
 *   status       — "active" | "paused" | "all" (default: "all")
 *   creativeType — "image" | "video" | "carousel" | "all" (default: "all")
 *   after        — pagination cursor from previous response
 *   limit        — results per page, max 50 (default: 25)
 */

import { NextRequest, NextResponse } from "next/server";

import { demoAds, type SearchFilters, type SearchMode } from "@/lib/demo-data";
import {
  fetchMetaAds,
  MetaApiError,
  type MetaSearchParams,
} from "@/lib/meta-api";

// In-memory rate limit tracker (resets on serverless cold start)
// Respects Meta's ~200 calls/hour; we guard at 180 to leave headroom.
let callCount = 0;
let windowStart = Date.now();
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_CALLS_PER_WINDOW = 180;

function withinRateLimit(): boolean {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    callCount = 0;
    windowStart = now;
  }
  if (callCount >= MAX_CALLS_PER_WINDOW) return false;
  callCount++;
  return true;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const query = searchParams.get("q") ?? "";
  const mode = (searchParams.get("mode") ?? "keyword") as SearchMode;
  const country = searchParams.get("country") ?? "all";
  const platform = searchParams.get("platform") ?? "all";
  const status = (searchParams.get("status") ?? "all") as SearchFilters["status"];
  const creativeType = (
    searchParams.get("creativeType") ?? "all"
  ) as SearchFilters["creativeType"];
  const after = searchParams.get("after") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit") ?? "25"), 50);

  const accessToken = process.env.META_ACCESS_TOKEN;

  // No token configured — serve demo data so the UI works in dev/preview
  if (!accessToken) {
    return NextResponse.json({
      ads: demoAds,
      nextCursor: null,
      source: "demo",
    });
  }

  // Local rate limit guard before hitting Meta's API
  if (!withinRateLimit()) {
    return NextResponse.json(
      {
        error:
          "Rate limit reached for this hour. Please wait and try again shortly.",
        code: 613,
        retryAfter: Math.ceil((windowStart + WINDOW_MS - Date.now()) / 1000),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((windowStart + WINDOW_MS - Date.now()) / 1000),
          ),
        },
      },
    );
  }

  const params: MetaSearchParams = {
    query,
    mode,
    country,
    platform,
    status,
    creativeType,
    after,
    limit,
  };

  try {
    const result = await fetchMetaAds(params, accessToken);
    return NextResponse.json({
      ads: result.ads,
      nextCursor: result.nextCursor ?? null,
      source: "meta",
    });
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (error.isRateLimit) {
        return NextResponse.json(
          {
            error:
              "Meta API rate limit reached. Please wait before making more requests.",
            code: error.code,
          },
          { status: 429, headers: { "Retry-After": "3600" } },
        );
      }

      if (error.isAuthError) {
        return NextResponse.json(
          {
            error:
              "Meta API authentication failed. Verify your META_ACCESS_TOKEN.",
            code: error.code,
          },
          { status: 401 },
        );
      }

      // Bad request / unknown Meta error
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 },
      );
    }

    // Network or unexpected error
    console.error("[api/ads/search] Unexpected error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 },
    );
  }
}
