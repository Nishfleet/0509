import { env } from "cloudflare:workers";
import { z } from "zod";

import { MAX_CLIENT_BRANDS } from "./client-brands";
import { readEntitlements } from "./data/plan.server";
import { setActiveWorkspace } from "./data/active_workspace.server";
import { ensureOwnerEmailTarget } from "./data/send_target.server";
import {
  insertWorkspace,
  readBillingWorkspaceId,
  readOwnedWorkspaces,
  readWorkspaceIdForOwner,
  readWorkspaceTimezone,
  WorkspaceCapError,
} from "./data/workspace.server";
import { isPerRunFixtureEmail } from "./fixture-accounts";

const MAX_NAME = 60;

const brandNameForm = z.object({ name: z.string().trim().min(1).max(MAX_NAME) });

export const BRAND_NAME_INVALID = `Give the client brand a name, up to ${String(MAX_NAME)} characters.`;
export const BRAND_FULL = `You have used all ${String(MAX_CLIENT_BRANDS)} client brands. Write to support to add more.`;
export const BRAND_NEEDS_AGENCY = "Client brands are part of the Agency plan.";
const BRAND_FAILED = "We couldn't add the client brand. Try again in a minute.";

export type AddBrandOutcome = { status: "added" } | { status: "refused"; message: string };

export async function addClientBrand(user: { id: string; email: string }, name: string): Promise<AddBrandOutcome> {
  const parsed = brandNameForm.safeParse({ name });
  if (!parsed.success) return { status: "refused", message: BRAND_NAME_INVALID };
  const activeId = await readWorkspaceIdForOwner(user.id);
  const parentId = activeId === null ? null : await readBillingWorkspaceId(activeId);
  if (activeId === null || parentId === null) return { status: "refused", message: BRAND_FAILED };
  if ((await clientBrandCount(user.id)) >= MAX_CLIENT_BRANDS) return { status: "refused", message: BRAND_FULL };
  const id = `ws-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await insertWorkspace(env.DB, {
      id,
      name: parsed.data.name,
      ownerUserId: user.id,
      timezone: await readWorkspaceTimezone(parentId),
      createdAt: now,
      fixture: isPerRunFixtureEmail(user.email),
      parentWorkspaceId: parentId,
    });
  } catch (error) {
    if (error instanceof WorkspaceCapError) {
      const full = (await clientBrandCount(user.id)) >= MAX_CLIENT_BRANDS;
      return { status: "refused", message: full ? BRAND_FULL : BRAND_NEEDS_AGENCY };
    }
    throw error;
  }
  await ensureOwnerEmailTarget(env.DB, { workspaceId: id, now });
  await setActiveWorkspace(user.id, id);
  return { status: "added" };
}

async function clientBrandCount(userId: string): Promise<number> {
  return (await readOwnedWorkspaces(userId)).filter((row) => row.parent_workspace_id !== null).length;
}

export async function switchClientBrand(userId: string, workspaceId: string): Promise<boolean> {
  return setActiveWorkspace(userId, workspaceId);
}

export interface BrandOption {
  id: string;
  name: string;
  current: boolean;
}

export interface BrandPanel {
  brands: BrandOption[];
  canAdd: boolean;
  full: boolean;
}

export async function readBrandPanel(userId: string): Promise<BrandPanel> {
  const [owned, activeId] = await Promise.all([readOwnedWorkspaces(userId), readWorkspaceIdForOwner(userId)]);
  const brands = owned.map((row) => ({ id: row.id, name: row.name, current: row.id === activeId }));
  if (activeId === null) return { brands, canAdd: false, full: false };
  const { workspaces_max: max } = await readEntitlements(activeId);
  const planAllows = max === null || max > brands.length;
  const full = owned.filter((row) => row.parent_workspace_id !== null).length >= MAX_CLIENT_BRANDS;
  return { brands, canAdd: planAllows && !full, full: planAllows && full };
}

export async function readOtherBrands(userId: string): Promise<BrandOption[]> {
  const [owned, activeId] = await Promise.all([readOwnedWorkspaces(userId), readWorkspaceIdForOwner(userId)]);
  return owned.filter((row) => row.id !== activeId).map((row) => ({ id: row.id, name: row.name, current: false }));
}
