const PROOF_PREFIX = "shot/e2e/capture-plate/";

export function captureKeyAllowed(objectKey: string): boolean {
  if (objectKey.includes("..") || objectKey.includes("\\") || objectKey.startsWith("/")) return false;
  return objectKey.startsWith(PROOF_PREFIX);
}
