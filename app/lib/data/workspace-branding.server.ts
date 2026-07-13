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
  updated_at: string;
}

export const WORKSPACE_BRAND_NAME_MAX_LENGTH = 60;
export const WORKSPACE_BRAND_WEBSITE_MAX_LENGTH = 2048;

function normalizeWorkspaceBrandName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().slice(0, WORKSPACE_BRAND_NAME_MAX_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkspaceBrandWebsite(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().slice(0, WORKSPACE_BRAND_WEBSITE_MAX_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getWorkspaceBranding(env: AppEnv, userId: string) {
  const row = await one<WorkspaceBrandingRow>(
    env,
    `
      SELECT user_id, brand_name, brand_website, updated_at
      FROM workspace_branding
      WHERE user_id = ?
    `,
    userId,
  );

  return { brandName: row?.brand_name ?? null, brandWebsite: row?.brand_website ?? null };
}

export async function upsertWorkspaceBranding(
  env: AppEnv,
  userId: string,
  input: { brandName?: string | null | undefined; brandWebsite?: string | null | undefined },
) {
  const current = await getWorkspaceBranding(env, userId);
  const hasBrandName = Object.prototype.hasOwnProperty.call(input, "brandName");
  const hasBrandWebsite = Object.prototype.hasOwnProperty.call(input, "brandWebsite");
  const brandName = hasBrandName ? normalizeWorkspaceBrandName(input.brandName) : current.brandName;
  const brandWebsite = hasBrandWebsite
    ? normalizeWorkspaceBrandWebsite(input.brandWebsite)
    : current.brandWebsite;

  await run(
    env,
    `
      INSERT INTO workspace_branding (user_id, brand_name, brand_website, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        brand_name = excluded.brand_name,
        brand_website = excluded.brand_website,
        updated_at = excluded.updated_at
    `,
    userId,
    brandName,
    brandWebsite,
    nowIso(),
  );

  return { brandName, brandWebsite };
}
