/**
 * Workspace branding D1 persistence.
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Leaf imports `d1.server` + `helpers.server` directly
 * (no `~/lib/data.server` cycle).
 */

import {
  execute as run,
  queryOne as one,
} from "~/lib/data/d1.server";
import { nowIso } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";

interface WorkspaceBrandingRow {
  user_id: string;
  brand_name: string | null;
  brand_website: string | null;
	brand_logo: string | null;
  updated_at: string;
}

export const WORKSPACE_BRAND_NAME_MAX_LENGTH = 60;
export const WORKSPACE_BRAND_WEBSITE_MAX_LENGTH = 2048;
// Hard cap on the encoded data URL (~64KB). Keeps the row comfortably inside
// D1 statement/row limits; anything larger belongs in R2, not here.
export const WORKSPACE_BRAND_LOGO_MAX_LENGTH = 65536;

// Raster formats only. SVG is deliberately excluded: an SVG logo is a stored-
// XSS vector the moment it is reused outside an <img> tag (emails, exported
// HTML), so it is rejected at the storage boundary, not just at render time.
const WORKSPACE_BRAND_LOGO_ALLOWED_PREFIXES = [
	"data:image/png;base64,",
	"data:image/jpeg;base64,",
	"data:image/webp;base64,",
] as const;

const BASE64_PAYLOAD_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function normalizeWorkspaceBrandName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().slice(0, WORKSPACE_BRAND_NAME_MAX_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkspaceBrandWebsite(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().slice(0, WORKSPACE_BRAND_WEBSITE_MAX_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeWorkspaceBrandLogo(value: string | null | undefined): string | null {
	const trimmed = (value ?? "").trim();
	if (trimmed.length === 0 || trimmed.length > WORKSPACE_BRAND_LOGO_MAX_LENGTH) {
		return null;
	}

	const prefix = WORKSPACE_BRAND_LOGO_ALLOWED_PREFIXES.find((allowed) =>
		trimmed.startsWith(allowed),
	);
	if (!prefix) {
		return null;
	}

	const payload = trimmed.slice(prefix.length);
	if (payload.length === 0 || !BASE64_PAYLOAD_PATTERN.test(payload)) {
		return null;
	}

	return trimmed;
}

export async function getWorkspaceBranding(env: AppEnv, userId: string) {
  const row = await one<WorkspaceBrandingRow>(
    env,
    `
      SELECT user_id, brand_name, brand_website, brand_logo, updated_at
      FROM workspace_branding
      WHERE user_id = ?
    `,
    userId,
  );

	return {
		brandName: row?.brand_name ?? null,
		brandWebsite: row?.brand_website ?? null,
		brandLogo: row?.brand_logo ?? null,
	};
}

export async function upsertWorkspaceBranding(
  env: AppEnv,
  userId: string,
	input: {
		brandName?: string | null | undefined;
		brandWebsite?: string | null | undefined;
		brandLogo?: string | null | undefined;
	},
) {
  const hasBrandName = Object.prototype.hasOwnProperty.call(input, "brandName");
  const hasBrandWebsite = Object.prototype.hasOwnProperty.call(input, "brandWebsite");
	const hasBrandLogo = Object.prototype.hasOwnProperty.call(input, "brandLogo");
	const brandName = hasBrandName ? normalizeWorkspaceBrandName(input.brandName) : null;
	const brandWebsite = hasBrandWebsite
		? normalizeWorkspaceBrandWebsite(input.brandWebsite)
		: null;
	const brandLogo = hasBrandLogo ? normalizeWorkspaceBrandLogo(input.brandLogo) : null;

  await run(
    env,
    `
      INSERT INTO workspace_branding (user_id, brand_name, brand_website, brand_logo, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
				brand_name = CASE
					WHEN ? = 1 THEN excluded.brand_name
					ELSE workspace_branding.brand_name
				END,
				brand_website = CASE
					WHEN ? = 1 THEN excluded.brand_website
					ELSE workspace_branding.brand_website
				END,
				brand_logo = CASE
					WHEN ? = 1 THEN excluded.brand_logo
					ELSE workspace_branding.brand_logo
				END,
        updated_at = excluded.updated_at
    `,
    userId,
    brandName,
    brandWebsite,
		brandLogo,
    nowIso(),
		hasBrandName ? 1 : 0,
		hasBrandWebsite ? 1 : 0,
		hasBrandLogo ? 1 : 0,
  );

	// Return the durable row rather than the caller's partial input. Omitted
	// fields are preserved by the atomic upsert above, even when another tab
	// updates a different field between requests.
	return getWorkspaceBranding(env, userId);
}
