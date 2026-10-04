export type GeneratorKey = "news" | "hn" | "ads" | "ai";

interface Evidence {
  sourceUrl: string;
  excerpt: string;
  generator: GeneratorKey;
  via?: string;
}

interface Candidate {
  name: string;
  domain?: string;
  evidence: Evidence[];
}

interface Subject {
  name: string;
  domain: string;
  description?: string | null;
}

interface FetchedText {
  ok: boolean;
  status: number;
  url: string;
  contentType: string | null;
  body: string;
}

type FetchText = (url: string) => Promise<FetchedText>;

type Generator = (subject: Subject, fetchText?: FetchText) => Promise<Candidate[]>;

export type { Candidate, Evidence, FetchText, FetchedText, Generator, Subject };

export function assertFetched(generator: GeneratorKey, page: FetchedText): void {
  if (!page.ok) throw new Error(`${generator} generator fetch failed with status ${String(page.status)}`);
}

export function logIfEmpty(generator: GeneratorKey, articles: number, candidates: readonly Candidate[]): void {
  if (candidates.length === 0) console.log(JSON.stringify({ event: "discovery.generator_empty", generator, articles }));
}
