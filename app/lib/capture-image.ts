const PROOF_PREFIX = "shot/e2e/capture-plate/";

export function captureKeyAllowed(objectKey: string): boolean {
  if (objectKey.includes("..") || objectKey.includes("\\") || objectKey.startsWith("/")) return false;
  return objectKey.startsWith(PROOF_PREFIX);
}

export function captureDimensions(
  width: string | null,
  height: string | null,
): { width: number; height: number } | null {
  const parsedWidth = oneDimension(width);
  const parsedHeight = oneDimension(height);
  if (parsedWidth === null || parsedHeight === null) return null;
  return { width: parsedWidth, height: parsedHeight };
}

function oneDimension(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed > 2000) return null;
  return parsed;
}
