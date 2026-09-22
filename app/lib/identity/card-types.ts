import type { NormalisedSubject } from "./normalise";

export interface CardField {
  name: string;
  value: string | null;
  state: "filled" | "check" | "empty";
  via: string;
  reason?: string;
}

export type CardResult =
  | {
      ok: true;
      subject: NormalisedSubject;
      entityId: string;
      onboardingRunId: string;
      fields: CardField[];
      packHash: string;
      verdictCount: number;
      transport: "fetch" | "browser" | null;
      browserMsUsed: number | null;
      jevStatus: "ok" | "unconfigured" | "unreachable";
      publicSubject: "cleared" | "ask" | "unverified";
      probeFailures: { leg: string; reason: string }[];
    }
  | { ok: false; reason: string };
