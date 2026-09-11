import { describe, expect, it } from "vitest";
import {
  DEFAULT_SELECTORS,
  evaluateAuthState,
  parseTxtRecords,
} from "../scripts/check-outbound-email-auth.mjs";

// Real dig output shape captured 2026-09-11 for the 0509.io zone (issue #2966).
// A DKIM key is longer than 255 bytes, so dig emits it as two adjacent quoted
// chunks and the parser must join them into one logical DKIM record.
const DIG_DKIM = `"v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78k" "m4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"`;
const DIG_SPF = `"v=spf1 include:_spf.mx.cloudflare.net -all"`;
const DIG_DMARC = `"v=DMARC1; p=reject; rua=mailto:dmarc@0509.io"`;

function stateFixture(overrides: Record<string, unknown> = {}) {
  return {
    spfRecords: parseTxtRecords(DIG_SPF),
    dmarcRecords: parseTxtRecords(DIG_DMARC),
    dkimSelectors: new Map(
      DEFAULT_SELECTORS.map((s) => [s, parseTxtRecords(DIG_DKIM)])
    ),
    requiredSelectors: DEFAULT_SELECTORS,
    ...overrides,
  };
}

describe("parseTxtRecords", () => {
  it("joins a multi-chunk DKIM TXT into one logical record", () => {
    const recs = parseTxtRecords(DIG_DKIM);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatch(/^v=DKIM1;/);
    expect(recs[0]).toContain("p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiwey");
    // The key chunks must actually be joined (>= 300 chars of logical record).
    expect(recs[0].length).toBeGreaterThan(300);
  });

  it("keeps single plain records as-is and drops comments", () => {
    const out = parseTxtRecords(`;; some header\n${DIG_SPF}\n${DIG_DMARC}`);
    expect(out).toContain("v=spf1 include:_spf.mx.cloudflare.net -all");
    expect(out).toContain("v=DMARC1; p=reject; rua=mailto:dmarc@0509.io");
    expect(out.some((r) => r.startsWith(";;"))).toBe(false);
  });
});

describe("evaluateAuthState", () => {
  it("passes on the verified live 0509.io state", () => {
    const v = evaluateAuthState(stateFixture());
    expect(v.ok).toBe(true);
    expect(v.failures).toEqual([]);
  });

  it("fails loud on ~all softfail SPF", () => {
    const v = evaluateAuthState(
      stateFixture({ spfRecords: ["v=spf1 include:_spf.mx.cloudflare.net ~all"] })
    );
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes("softfail"))).toBe(true);
  });

  it("fails loud on a missing DMARC rua barrel", () => {
    const v = evaluateAuthState(
      stateFixture({ dmarcRecords: ["v=DMARC1; p=reject;"] })
    );
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes("rua"))).toBe(true);
  });

  it("fails loud on a non-enforcement DMARC policy", () => {
    const v = evaluateAuthState(
      stateFixture({ dmarcRecords: ["v=DMARC1; p=none; rua=mailto:dmarc@0509.io"] })
    );
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes("enforcement"))).toBe(true);
  });

  it("fails loud on a weak p tag but passes quarantine", () => {
    const quarantine = evaluateAuthState(
      stateFixture({ dmarcRecords: ["v=DMARC1; p=quarantine; rua=mailto:dmarc@0509.io"] })
    );
    expect(quarantine.ok).toBe(true);
  });

  it("fails loud when a required selector is unpublished", () => {
    const v = evaluateAuthState(
      stateFixture({ dkimSelectors: new Map([["cf2024-1", []]]) })
    );
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes("cf2024-1"))).toBe(true);
  });

  it("fails loud on a selector record with empty key material", () => {
    const v = evaluateAuthState(
      stateFixture({
        dkimSelectors: new Map([[
          "cf2024-1",
          ['v=DKIM1; h=sha256; k=rsa; p='],
        ]]),
      }));
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes("p= key"))).toBe(true);
  });

  it("propagates the required selectors into failure messages", () => {
    const v = evaluateAuthState(
      stateFixture({ requiredSelectors: ["cf-bounce"] })
    );
    expect(v.failures.some((f) => f.includes("cf-bounce"))).toBe(true);
  });
});
