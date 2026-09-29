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
        url: response.url,
        contentType: response.headers.get("content-type"),
        body: await response.text(),
      };
    } catch (error) {
      console.error(JSON.stringify({ event, error: String(error) }));
      return { ok: false, url, contentType: null, body: "" };
    }
  };
}
