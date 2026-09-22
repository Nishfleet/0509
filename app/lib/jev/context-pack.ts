interface IdentityPack {
  self: { name: string | null; domain: string | null };
  subject: { input: string; kind: string; registrable: string | null; platform: string | null };
  item: Record<string, { value: unknown; via: string }>;
  history_30d: unknown[];
  user_memory: unknown[];
  reliability: Record<string, string>;
}

export function buildIdentityPack(input: {
  raw: string;
  kind: string;
  registrable: string | null;
  platform: string | null;
  fields: Record<string, { value: unknown; via: string }>;
  reliability?: Record<string, string>;
}): IdentityPack {
  return {
    self: { name: null, domain: input.registrable },
    subject: {
      input: input.raw,
      kind: input.kind,
      registrable: input.registrable,
      platform: input.platform,
    },
    item: input.fields,
    history_30d: [],
    user_memory: [],
    reliability: input.reliability ?? {},
  };
}

export async function inputHash(pack: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
