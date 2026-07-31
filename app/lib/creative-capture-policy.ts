import { isAdLibraryBackedAd } from "~/lib/ad-source-kind";
import { hashString } from "~/lib/normalize";
import type { AdRecord } from "~/lib/types";

// Reuse persisted unreadable outcomes briefly, but retry later in case a
// provider binding or the remote creative has recovered.
export const CREATIVE_CAPTURE_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function creativeCaptureSourceFingerprint(
  ad: {
    adSnapshotUrl?: string | null;
    creativeImageUrl?: string | null;
  },
  captureUrl?: string | null,
) {
  const imageUrl = ad.creativeImageUrl?.trim() || null;
  const explicitCaptureUrl = captureUrl?.trim() || null;
  const snapshotUrl =
    ad.adSnapshotUrl?.trim() ||
    (explicitCaptureUrl && explicitCaptureUrl !== imageUrl
      ? explicitCaptureUrl
      : null);
  if (!snapshotUrl && !imageUrl) return null;
  return hashString(JSON.stringify([snapshotUrl, imageUrl]));
}

export function shouldAttemptCreativeTextCapture(
  ad: AdRecord,
  nowMs = Date.now(),
) {
  if (
    !isAdLibraryBackedAd(ad) ||
    !Boolean(ad.adSnapshotUrl?.trim() || ad.creativeImageUrl?.trim()) ||
    Boolean(ad.creativeText?.trim())
  ) {
    return false;
  }

  const metadata = ad.creativeTextMetadata;
  const hasUnreadableResult =
    metadata?.extractionStatus === "unreadable" ||
    typeof metadata?.unreadableReasonCode === "string";
  if (!hasUnreadableResult) return true;

  const currentSourceFingerprint = creativeCaptureSourceFingerprint(ad);
  const capturedSourceFingerprint =
    typeof metadata?.creativeSourceFingerprint === "string"
      ? metadata.creativeSourceFingerprint
      : null;
  const requestedSourceFingerprint =
    typeof metadata?.creativeRequestedSourceFingerprint === "string"
      ? metadata.creativeRequestedSourceFingerprint
      : null;
  if (
    !currentSourceFingerprint ||
    (
      capturedSourceFingerprint !== currentSourceFingerprint &&
      requestedSourceFingerprint !== currentSourceFingerprint
    )
  ) {
    return true;
  }

  const capturedAt =
    typeof metadata?.capturedAt === "string"
      ? Date.parse(metadata.capturedAt)
      : Number.NaN;
  if (!Number.isFinite(capturedAt) || capturedAt > nowMs) return true;
  return nowMs - capturedAt >= CREATIVE_CAPTURE_RETRY_COOLDOWN_MS;
}
