import type { AnalysisSource, CaptureMethod } from "~/lib/types";

export function formatCaptureMethodLabel(captureMethod: CaptureMethod | null | undefined) {
  if (captureMethod === "landing_page_fetch") {
    return "Fetch capture";
  }

  if (captureMethod === "browser_render") {
    return "Browser-rendered";
  }

  return "Capture unavailable";
}

export function formatLandingPageSignalValue(value: string | null | undefined) {
  return value?.trim() ? value : "Not detected";
}

export function formatLandingPageFormValue(value: boolean | null | undefined) {
  if (value === true) {
    return "Yes";
  }

  if (value === false) {
    return "No";
  }

  return "Not detected";
}

export function formatAnalysisSourceLabel(source: AnalysisSource | null | undefined) {
  if (source === "ad_snapshot_fetch") {
    return "Ad snapshot fetch";
  }

  if (source === "landing_page_fetch") {
    return "Fetch capture";
  }

  if (source === "browser_render") {
    return "Browser-rendered";
  }

  if (source === "meta_api") {
    return "Meta API";
  }

  if (source === "ai_summary") {
    return "AI summary";
  }

  if (source === "user") {
    return "Manual";
  }

  return "Source unavailable";
}
