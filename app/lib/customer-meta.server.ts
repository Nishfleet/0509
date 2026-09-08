import {
  deleteCustomerMetaConnection,
  getCustomerMetaConnection,
  updateCustomerMetaConnectionStatus,
  upsertCustomerMetaConnection,
} from "~/lib/data.server";
import {
  credentialFingerprint,
  decryptCredential,
  encryptCredential,
} from "~/lib/credential-crypto.server";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout } from "~/lib/fetch-timeout.server";
import type { CustomerMetaConnectionRecord } from "~/lib/types";

const TOKEN_MIN_LENGTH = 20;
const TOKEN_TEST_TIMEOUT_MS = 15_000;
const TOKEN_TEST_JSON_MAX_BYTES = 32_000;

interface MetaTokenTestResult {
  ok: boolean;
  status: CustomerMetaConnectionRecord["status"];
  summary: string;
  errorCode: string | null;
  errorMessage: string | null;
}

interface MetaApiErrorPayload {
  error?: {
    code?: number;
    error_subcode?: number;
    message?: string;
    type?: string;
  };
}

type FetchImpl = typeof fetch;

function normalizeToken(value: string) {
  return value.trim();
}

function tokenLastFour(token: string) {
  return token.slice(-4);
}

function friendlyTokenFailure(payload: MetaApiErrorPayload, fallbackMessage: string) {
  const code = payload.error?.code ?? null;
  const subcode = payload.error?.error_subcode ?? null;
  const message = payload.error?.message ?? fallbackMessage;
  const errorCode = subcode ? `${code ?? "meta"}:${subcode}` : code ? String(code) : "meta_api_error";

  if (code === 190 || code === 102) {
    return {
      errorCode,
      summary: "This token is expired or invalid. Generate a fresh token in Meta and paste it here.",
      errorMessage: message,
    };
  }

  if (code === 10 || code === 100 || code === 200) {
    return {
      errorCode,
      summary:
        "Meta rejected this token for Ad Library API access. Finish Meta's Ad Library API access steps, then try again.",
      errorMessage: message,
    };
  }

  return {
    errorCode,
    summary: "Meta could not verify this token. Try a fresh token from the same Meta developer app.",
    errorMessage: message,
  };
}

export async function testCustomerMetaToken(
  env: AppEnv,
  tokenInput: string,
  options: { fetchImpl?: FetchImpl } = {},
): Promise<MetaTokenTestResult> {
  const token = normalizeToken(tokenInput);
  if (token.length < TOKEN_MIN_LENGTH || /\s/.test(token)) {
    return {
      ok: false,
      status: "degraded",
      summary: "Paste the full Meta access token. It should be one long string with no spaces.",
      errorCode: "invalid_format",
      errorMessage: "The submitted token is too short or contains spaces.",
    };
  }

  const version = env.META_AD_LIBRARY_API_VERSION?.trim() || "v23.0";
  const params = new URLSearchParams();
  params.set("access_token", token);
  params.set("fields", "id,page_name,ad_snapshot_url");
  params.set("limit", "1");
  params.set("search_terms", "california");
  params.set("search_type", "KEYWORD_UNORDERED");
  params.set("ad_type", "POLITICAL_AND_ISSUE_ADS");
  params.set("ad_reached_countries", "['US']");

  try {
    const response = await fetchWithTimeout(
      `https://graph.facebook.com/${version}/ads_archive?${params.toString()}`,
      {},
      { fetcher: options.fetchImpl ?? fetch, timeoutMs: TOKEN_TEST_TIMEOUT_MS },
    );
    const payload = await readResponseJsonWithinLimit<MetaApiErrorPayload>(
      response,
      TOKEN_TEST_JSON_MAX_BYTES,
    );
    if (!payload) {
      return {
        ok: false,
        status: "degraded",
        summary: "Meta returned an unreadable token-check response. Try again before saving this token.",
        errorCode: "invalid_provider_response",
        errorMessage: `Meta returned status ${response.status} with an unreadable response body.`,
      };
    }

    if (!response.ok || payload.error) {
      const failure = friendlyTokenFailure(
        payload,
        `Meta returned status ${response.status} while checking the token.`,
      );

      return {
        ok: false,
        status: "degraded",
        ...failure,
      };
    }

    return {
      ok: true,
      status: "healthy",
      summary:
        "Connected. Five to Nine can use this customer-owned token for Meta Ad Library API fallback.",
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        status: "degraded",
        summary: "Meta did not respond in time. Try testing the token again.",
        errorCode: "timeout",
        errorMessage: error.message,
      };
    }

    return {
      ok: false,
      status: "degraded",
      summary: "Could not reach Meta to test this token. Try again in a minute.",
      errorCode: "network_error",
      errorMessage: error instanceof Error ? error.message : "Unknown token test error.",
    };
  }
}

export async function saveCustomerMetaToken(
  env: AppEnv,
  userId: string,
  tokenInput: string,
  options: { fetchImpl?: FetchImpl } = {},
) {
  const token = normalizeToken(tokenInput);
  const testResult = await testCustomerMetaToken(env, token, options);
  if (!testResult.ok) {
    return {
      ok: false,
      connection: null,
      testResult,
    };
  }

  const connection = await upsertCustomerMetaConnection(env, {
    userId,
    encryptedAccessToken: await encryptCredential(env, token),
    tokenLastFour: tokenLastFour(token),
    tokenFingerprint: await credentialFingerprint(token),
    status: testResult.status,
    summary: testResult.summary,
    lastErrorCode: testResult.errorCode,
    lastErrorMessage: testResult.errorMessage,
  });

  return {
    ok: true,
    connection,
    testResult,
  };
}

export async function retestSavedCustomerMetaToken(env: AppEnv, userId: string) {
  const connection = await getCustomerMetaConnection(env, userId);
  if (!connection) {
    return {
      ok: false,
      connection: null,
      testResult: {
        ok: false,
        status: "degraded" as const,
        summary: "No Meta token is connected yet.",
        errorCode: "missing_connection",
        errorMessage: null,
      },
    };
  }

  const token = await decryptCredential(env, connection.encryptedAccessToken);
  const testResult = await testCustomerMetaToken(env, token);
  const updatedConnection = await updateCustomerMetaConnectionStatus(env, {
    userId,
    status: testResult.status,
    summary: testResult.summary,
    lastErrorCode: testResult.errorCode,
    lastErrorMessage: testResult.errorMessage,
  });

  return {
    ok: testResult.ok,
    connection: updatedConnection,
    testResult,
  };
}

export async function disconnectCustomerMetaToken(env: AppEnv, userId: string) {
  await deleteCustomerMetaConnection(env, userId);
}

export async function getCustomerMetaAdLibraryToken(env: AppEnv, userId: string) {
  const connection = await getCustomerMetaConnection(env, userId);
  if (!connection || connection.status !== "healthy") {
    return null;
  }

  try {
    return await decryptCredential(env, connection.encryptedAccessToken);
  } catch {
    return null;
  }
}
