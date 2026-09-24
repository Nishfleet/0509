import { env } from "cloudflare:workers";

import { latestAdlibPayloadKey } from "../data/adlib.server";
import { parseStoredCandidates } from "./generators/meta-adlib";
import type { Candidate } from "./types";

export async function storedMetaCandidates(workspaceId: string): Promise<Candidate[]> {
  const key = await latestAdlibPayloadKey(workspaceId);
  if (key === null) return [];
  const object = await env.SNAPSHOTS.get(key);
  if (object === null) return [];
  return parseStoredCandidates(await object.text());
}

export async function writeAdlibPayload(key: string, body: string): Promise<void> {
  await env.SNAPSHOTS.put(key, body);
}

export async function readAdlibPayload(key: string): Promise<string | null> {
  const object = await env.SNAPSHOTS.get(key);
  if (object === null) return null;
  return object.text();
}
