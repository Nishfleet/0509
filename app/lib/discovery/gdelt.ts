import { z } from "zod";

export const GDELT_SEARCH_URL =
  "https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=50&timespan=7d&sort=datedesc&query=";

const gdeltArticleSchema = z.object({
  url: z.string(),
  title: z.string().min(1),
  seendate: z.string().nullish(),
  domain: z.string().nullish(),
});

export const gdeltResponseSchema = z.object({
  articles: z.array(gdeltArticleSchema).default([]),
});

export const gdeltWebUrlSchema = z.url({ protocol: /^https?$/ });

const SEENDATE_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

export function gdeltSeendateToIso(seendate: string | null | undefined): string | null {
  const match = SEENDATE_PATTERN.exec(seendate ?? "");
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}
