import { z } from "zod";

export const CandidateEvidence = z.object({
  sourceUrl: z.string(),
  excerpt: z.string(),
  generator: z.string(),
  publisherDomain: z.string().optional(),
});
export type CandidateEvidence = z.infer<typeof CandidateEvidence>;

export const Candidate = z.object({
  name: z.string(),
  domain: z.string().optional(),
  evidence: z.array(CandidateEvidence),
});
export type Candidate = z.infer<typeof Candidate>;

export interface DiscoverySubject {
  name: string;
  domain: string;
  category?: string | null;
  country?: string | null;
}

export interface GeneratorEnv {
  fetchImpl?: typeof fetch;
  onPayload?: (payload: { url: string; contentType: string; body: string }) => void;
}

export type Generator = (subject: DiscoverySubject, env: GeneratorEnv) => Promise<Candidate[]>;

export function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
