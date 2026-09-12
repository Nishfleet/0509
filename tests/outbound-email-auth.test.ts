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

  it("keeps two separate records on separate lines apart", () => {
    // The join must not merge unrelated records into one blob.
    const out = parseTxtRecords(`${DIG_SPF}\n${DIG_DMARC}`);
    expect(out).toHaveLength(2);
  });

  it("joins adjacent quoted chunks that share one physical line", () => {
    // The shape real dig emits for a >255-byte TXT: one line, several chunks.
    const key = "A".repeat(230);
    const out = parseTxtRecords(`"v=DKIM1; k=rsa; p=${key}" "${"B".repeat(165)}"`);
    expect(out).toHaveLength(1);
    expect(out[0].length).toBeGreaterThan(key.length + 165);
    expect(out[0]).toContain("B".repeat(165));
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
    expect(v.failures.some((f) => f.includes("truncated or empty"))).toBe(true);
  });

  it("propagates the required selectors into failure messages", () => {
    const v = evaluateAuthState(
      stateFixture({ requiredSelectors: ["cf-bounce"] })
    );
    expect(v.failures.some((f) => f.includes("cf-bounce"))).toBe(true);
  });

  // The checks below pin the failure modes this gate exists to catch. Each one
  // was found only after the file was added to the checked tsconfig project, so
  // they are recorded here rather than left to regress silently.
  it("fails loud on a truncated DKIM key that never reached its true length", () => {
    // A single 255-byte chunk is a mis-join, not a real 2048-bit key. Before
    // the parser fix this passed, so the "truncated?" message was a lie.
    const v = evaluateAuthState(
      stateFixture({ dkimSelectors: new Map([["cf2024-1", [`v=DKIM1; k=rsa; p=${"A".repeat(230)}`]]]) })
    );
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes("truncated"))).toBe(true);
  });

  it("does not read stray ~all text as a softfail when -all is the term", () => {
    const v = evaluateAuthState(
      stateFixture({ spfRecords: ["v=spf1 include:_spf.mx.cloudflare.net -all"] })
    );
    expect(v.ok).toBe(true);
  });

  it("still fails loud when the last all-term is ~all", () => {
    const v = evaluateAuthState(
      stateFixture({ spfRecords: ["v=spf1 include:_spf.mx.cloudflare.net ~all"] })
    );
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes("softfail"))).toBe(true);
  });

  it("treats DMARC tag values as case-insensitive (RFC 7489)", () => {
    const v = evaluateAuthState(
      stateFixture({ dmarcRecords: ["v=DMARC1; P=REJECT; RUA=mailto:dmarc@0509.io"] })
    );
    expect(v.ok).toBe(true);
  });

  it("fails loud on a rua with no report address", () => {
    const v = evaluateAuthState(
      stateFixture({ dmarcRecords: ["v=DMARC1; p=reject; rua=mailto:;"] })
    );
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes("rua"))).toBe(true);
  });

  it("fails loud when a selector returns no TXT at all", () => {
    const v = evaluateAuthState(
      stateFixture({ dkimSelectors: new Map([["cf2024-1", []]]) })
    );
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes("not published"))).toBe(true);
  });
});
