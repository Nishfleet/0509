export type GeneratorKey = "news" | "hn" | "ads";

interface Evidence {
  sourceUrl: string;
  excerpt: string;
  generator: GeneratorKey;
}

interface Candidate {
  name: string;
  domain?: string;
  evidence: Evidence[];
}

interface Subject {
  name: string;
  domain: string;
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

export function defaultFetchText(event: string): FetchText {
  return async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      return {
        ok: response.ok,
        status: response.status,
        url: response.url,
        contentType: response.headers.get("content-type"),
        body: await response.text(),
      };
    } catch (error) {
      console.error(JSON.stringify({ event, error: String(error) }));
      return { ok: false, status: 0, url, contentType: null, body: "" };
    }
  };
}

export function assertFetched(generator: GeneratorKey, page: FetchedText): void {
  if (!page.ok) throw new Error(`${generator} generator fetch failed with status ${String(page.status)}`);
}

export function logIfEmpty(generator: GeneratorKey, articles: number, candidates: readonly Candidate[]): void {
  if (candidates.length === 0) console.log(JSON.stringify({ event: "discovery.generator_empty", generator, articles }));
}
