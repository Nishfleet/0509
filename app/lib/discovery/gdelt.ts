import { z } from "zod";

export const GDELT_SEARCH_URL =
  "https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=50&timespan=7d&sort=datedesc&query=";

const gdeltArticleSchema = z.object({
  url: z.string(),
  title: z.string(),
  seendate: z.string().nullish(),
  domain: z.string().nullish(),
});

export const gdeltResponseSchema = z.object({
  articles: z.array(gdeltArticleSchema).default([]),
});

const SEENDATE_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

export function gdeltSeendateToIso(seendate: string | null | undefined): string | null {
  const value = seendate ?? "";
  if (!SEENDATE_PATTERN.test(value)) return null;
  return value.replace(SEENDATE_PATTERN, "$1-$2-$3T$4:$5:$6Z");
}
