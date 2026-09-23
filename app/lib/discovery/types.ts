type GeneratorKey = "news" | "hn" | "ads";

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
