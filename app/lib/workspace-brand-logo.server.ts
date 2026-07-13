import { normalizeWorkspaceBrandLogo } from "~/lib/data/workspace-branding.server";

export const WORKSPACE_BRAND_LOGO_MAX_BYTES = 48_000;

type WorkspaceBrandLogoUploadResult =
  | { ok: true; brandLogo?: string }
  | { ok: false; message: string };

const ALLOWED_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function parseWorkspaceBrandLogoUpload(
  value: FormDataEntryValue | null,
): Promise<WorkspaceBrandLogoUploadResult> {
  if (value === null) {
    return { ok: true };
  }

  if (typeof value === "string") {
    return invalidLogo("Choose a PNG, JPEG, or WebP logo file.");
  }

  if (value.size === 0 && value.name.length === 0) {
    return { ok: true };
  }

  if (value.size === 0) {
    return invalidLogo("Choose a non-empty PNG, JPEG, or WebP logo.");
  }

  if (value.size > WORKSPACE_BRAND_LOGO_MAX_BYTES) {
    return invalidLogo("Logo must be 48 KB or smaller.");
  }

  if (!ALLOWED_LOGO_MIME_TYPES.has(value.type)) {
    return invalidLogo("Use a PNG, JPEG, or WebP logo. SVG files are not accepted.");
  }

  const bytes = new Uint8Array(await value.arrayBuffer());
  const detectedType = detectRasterMimeType(bytes);
  if (detectedType !== value.type) {
    return invalidLogo(
      "That file's contents do not match its image type. Choose a PNG, JPEG, or WebP logo.",
    );
  }

  const dataUrl = `data:${detectedType};base64,${encodeBase64(bytes)}`;
  const brandLogo = normalizeWorkspaceBrandLogo(dataUrl);
  if (!brandLogo) {
    return invalidLogo("Choose a valid PNG, JPEG, or WebP logo.");
  }

  return { ok: true, brandLogo };
}

function invalidLogo(message: string): WorkspaceBrandLogoUploadResult {
  return { ok: false, message };
}

function detectRasterMimeType(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png" as const;
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg" as const;
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp" as const;
  }

  return null;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
