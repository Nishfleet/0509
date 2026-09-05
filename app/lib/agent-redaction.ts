type JsonRecord = Record<string, unknown>;

export function isSecretishMemoryField(value: string) {
  return /^(key|token|secret|password)$/i.test(value.trim()) ||
    /(authorization|bearer|credential|encrypted|password|secret|token|webhook|api[_-]?key|privatekey|accesskey)/i
    .test(value);
}

export function isSecretishMemoryString(value: string) {
  const normalized = value.trim();
  return (
    containsSecretishJsonMemoryValue(normalized) ||
    /(?:^|[^a-z0-9_])f9_live_[a-z0-9_-]+/i.test(normalized) ||
    /\b(?:bearer\s+[a-z0-9._~+/=-]+|xox[baprs]-[a-z0-9-]+|sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,})\b/i.test(normalized) ||
    /\b(?:sk|rk)_(?:live|test)_[a-z0-9]{12,}\b/i.test(normalized) ||
    /\bwhsec_[a-z0-9]{12,}\b/i.test(normalized) ||
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(normalized) ||
    /\bAIza[0-9A-Za-z_-]{35}\b/.test(normalized) ||
    containsOpaqueCredentialToken(normalized) ||
    /(?:^|[{\s,])["']?(?:password|passphrase|api[_-]?key|access[_-]?key|secret|token|authorization|webhook(?:[_-]?url)?)["']?\s*[:=]\s*["']?\S+/i.test(normalized) ||
    /\b[a-z0-9_]*(?:api[_-]?key|access[_-]?key|secret|token|password|webhook)[a-z0-9_]*\s*=\s*\S+/i.test(normalized) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(normalized) ||
    /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/i.test(normalized) ||
    /\bhooks\.slack\.com\/services\/[^\s"'<>]+/i.test(normalized) ||
    /https:\/\/[^\s"'<>]*(?:hooks\.slack\.com\/services|hooks\.zapier\.com\/hooks\/catch|discord(?:app)?\.com\/api\/webhooks|webhook\.office\.com|outlook\.office\.com\/webhook|\/(?:api\/)?webhooks?\/|\/hooks\/catch\/)[^\s"'<>]*/i.test(normalized) ||
    /https:\/\/[^\s"'<>]*(?:logic\.azure\.com|powerautomate\.com)[^\s"'<>]*\bsig=/i.test(normalized) ||
    /(?:\/share\/[a-z0-9_-]{12,}|https:\/\/[^/\s]+\/share\/[a-z0-9_-]{12,})/i.test(normalized)
  );
}

function containsOpaqueCredentialToken(value: string) {
  if (isUuid(value)) {
    return false;
  }
  if (/^[A-Za-z0-9+/=]{40,}$/.test(value) && hasMixedTokenShape(value.replace(/=+$/, ""))) {
    return true;
  }

  const candidates = value.match(/\b[A-Za-z0-9_-]{40,}\b/g) ?? [];
  return candidates.some((candidate) =>
    !isUuid(candidate) && (
      /^[a-f0-9]{48,}$/i.test(candidate) ||
      hasMixedTokenShape(candidate)
    )
  );
}

function hasMixedTokenShape(value: string) {
  return /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}

function isUuid(value: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

function containsSecretishJsonMemoryValue(value: string) {
  const normalized = value.trim();
  if (!normalized || !/^[{["]/.test(normalized)) {
    return false;
  }

  try {
    return hasSecretishMemoryContent(JSON.parse(normalized));
  } catch {
    return false;
  }
}

function hasSecretishMemoryContent(value: unknown): boolean {
  if (typeof value === "string") {
    return isSecretishMemoryString(value);
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretishMemoryContent);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as JsonRecord).some(([key, nested]) =>
      isSecretishMemoryField(key) || isSecretishMemoryString(key) || hasSecretishMemoryContent(nested)
    );
  }
  return false;
}
