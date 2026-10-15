import { z } from "zod";

export function normalizeEmailAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function looksLikeEmailAddress(address: string): boolean {
  return z.email().safeParse(address).success;
}
