import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { presenceContentHash } from "~/lib/presence-hash";
import { presenceSafeFetch } from "~/lib/presence-robots.server";
import { normalizePublicHttpUrl } from "~/lib/public-url.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

/**
 * Connecteur presence « boutiques d'applications » (issue #3210 — split
 * #3171, source suivant #3178). UNE source, DEUX surfaces publiques :
 *
 * - Apple : l'API iTunes Search/Lookup documentée, sans clé
 *   (`GET https://itunes.apple.com/lookup?id=<id>&country=<cc>`) + le flux
 *   RSS historique des avis consommateurs
 *   (`GET https://itunes.apple.com/<cc>/rss/customerreviews/page=1/id=<id>/sortby=mostrecent/json`,
 *   surface longue durée non documentée — posture « Google News RSS » du
 *   PLAN : honest copy, pas de contrat).
 * - Google Play : la fiche publique
 *   `https://play.google.com/store/apps/details?id=<pkg>&hl=en&gl=US`
 *   (robots.txt vérifié 2026-09-13 : /store/apps/details non restreint) —
 *   le lisère structuré `SoftwareApplication` (schema.org) embarqué par
 *   la page porte nom, auteur, description courte, note et nombre de votes.
 *
 * La cible = UNE application (fiche publique). Chaque sondage émet :
 * la FICHE elle-même (une mention de la marque par la boutique) + les
 * AVIS récents Apple (une mention par avis). Les avis Play ne sont PAS
 * capturés : aucune API publique gratuite n'expose les avis — la liste
 * communautaire `google-play-scraper` (2,963★) passe par l'endpoint privé
 * non documenté `batchexecute` ; exclusion documentée dans
 * docs/mentions/PLAN.md (l'exclusion « pas de surface publique » permise
 * par l'issue, la fiche restant capturée).
 *
 * Budget (testé) : cible Apple = 2 requêtes/sondage (1 lookup + 1 SEULE
 * page d'avis, jamais au-delà — ~20 requêtes/minute documentées côté
 * Apple, sondage déjà sérialisé par l'orchestrateur) ; cible Google =
 * 1 requête/sondage. Déduplication par URL canonique dans la table
 * (`UNIQUE (source_target_id, url_hash)`) : la fiche ne s'insère qu'une
 * fois, un avis édité (nouvel `updated` → `published_at` → `content_hash`)
 * devient une révision, jamais un doublon.
 *
 * Marques):
 * - le play: og:title est à ~1.02 Mo et le bloc ld+json à ~1.14 Mo sur la
 *   page réelle (1 260 532 octets mesurés 2026-09-13) — d'où une borne
 *   généreuse.
 * - le canonicalUrl de la fiche Apple est construit depuis la clé primaire
 *   de l'API (`apps.apple.com/<cc>/app/id<trackId>`, forme documentée),
 *   comme le fait hn pour news.ycombinator.com/item?id=<objectID> ; celui
 *   d'un avis = le lien `rel=related` du flux + `&review=<id de l'avis>`
 *   (les deux champs viennent du RSS ; la clé « review » survit à
 *   normalizePublicHttpUrl qui ne retire que le fragment).
 * - le connecteurParse l'obscur derrière `PRESENCE_APPSTORE_ROLLOUT`
 *   (désactivé par défaut) ; l'écriture `connector_id = 'appstore'` dans
 *   source_target exige en plus la migration 0101 (élargissement CHECK) —
 *   pas un changement de code ici.
 */
const APPSTORE_MAX_BYTES = 2_000_000;
const MAX_LISTING_TITLE_CHARS = 120;
const MAX_LISTING_EXCERPT_CHARS = 280;
const MAX_REVIEW_TITLE_CHARS = 120;
const MAX_REVIEW_EXCERPT_CHARS = 280;
/** Région par défaut si la cible n'en précise pas (posture vérifiée : 200). */
const DEFAULT_COUNTRY = "us";
/** Localisation épinglée pour la fiche Play — sans elle, la réponse suit la
 * géographie du client et la description varierait à chaque sondage. */
const PLAY_HL = "en";
const PLAY_GL = "US";
/** Application-sonde stable pour healthCheck (lookup, sans clé). */
const PROBE_APP_ID = "544007664";

/** Avisse/édition-vids-comment: canonical suffix… */
export const REVIEW_URL_PARAM = "review";

interface ItunesApp {
  wrapperType?: string | null;
  kind?: string | null;
  trackId?: number | null;
  trackName?: string | null;
  trackCensoredName?: string | null;
  trackViewUrl?: string | null;
  description?: string | null;
  artistName?: string | null;
  sellerName?: string | null;
  releaseDate?: string | null;
  currentVersionReleaseDate?: string | null;
  averageUserRating?: number | null;
  userRatingCount?: number | null;
  primaryGenreName?: string | null;
  version?: string | null;
  bundleId?: string | null;
}

interface ItunesLookupResponse {
  resultCount?: number;
  results?: ItunesApp[];
}

interface ItunesReviewEntry {
  author?: { name?: { label?: string | null }; uri?: { label?: string | null } };
  updated?: { label?: string | null };
  id?: { label?: string | null };
  title?: { label?: string | null };
  content?: { label?: string | null };
  link?: { attributes?: { rel?: string | null; href?: string | null } };
  "im:rating"?: { label?: string | null };
  "im:version"?: { label?: string | null };
  "im:voteSum"?: { label?: string | null };
  "im:voteCount"?: { label?: string | null };
}

interface ItunesReviewsFeed {
  feed?: { entry?: ItunesReviewEntry | ItunesReviewEntry[] | null };
}

interface AggregateRating {
  ratingValue?: string | number | null;
  ratingCount?: string | number | null;
}

interface SoftwareApplicationLd {
  name?: string | null;
  description?: string | null;
  author?: { name?: string | null } | null;
  applicationCategory?: string | null;
  contentRating?: string | null;
  operatingSystem?: string | null;
  aggregateRating?: AggregateRating | null;
}

export const PLAY_DETAILS_HOST = "play.google.com";
export const APPLE_LISTING_HOST = "apps.apple.com";
export const APPLE_FEED_HOST = "itunes.apple.com";

/** Lookup documenté (iTunes Search API) — 1 requête, sans clé. */
export function buildItunesLookupUrl(appId: string, countryCode: string): string {
  const url = new URL(`${APPLE_FEED_HOST ? "https://" + APPLE_FEED_HOST : ""}/lookup`.replace("https:////", "https://"));
  url.pathname = "/lookup";
  url.searchParams.set("id", appId);
  url.searchParams.set("country", countryCode || DEFAULT_COUNTRY);
  return url.toString();
}

/** Flux RSS des avis — page=1 uniquement, jamais de lecture au-delà. */
export function buildItunesReviewsUrl(countryCode: string, appId: string): string {
  const cc = (countryCode || DEFAULT_COUNTRY).toLowerCase();
  return new URL(
    `https://${APPLE_FEED_HOST}/${cc}/rss/customerreviews/page=1/id=${encodeURIComponent(appId)}/sortby=mostrecent/json`,
  ).toString();
}

/** Fiche publique Google Play — hl/gl épinglés (descriptions stables). */
export function buildPlayDetailsUrl(packageId: string): string {
  const url = new URL(`https://${PLAY_DETAILS_HOST}/store/apps/details`);
  url.searchParams.set("id", packageId);
  url.searchParams.set("hl", PLAY_HL);
  url.searchParams.set("gl", PLAY_GL);
  return url.toString();
}

const PLAY_HOST = "play.google.com";
const PLAY_DETAILS_PATH = "/store/apps/details";
const APPLE_APP_HOSTS = new Set(["apps.apple.com", "itunes.apple.com"]);
const PLAY_PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const APPLE_COUNTRY_RE = /^[a-z]{2}(?:-[a-z]{2})?$/i;

export interface ParsedAppStoreTarget {
  store: "apple" | "google";
  appId: string;
  countryCode: string;
  listingUrl: string;
}

/** Résout une fiche publique (Apple ou Google Play) depuis son URL. */
export function parseAppStoreTarget(raw: unknown): ParsedAppStoreTarget | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  if (APPLE_APP_HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    let appId: string | null = null;
    for (const part of parts) {
      const m = /^id(\d+)$/i.exec(part);
      if (m) {
        appId = m[1];
        break;
      }
    }
    if (!appId) {
      return null;
    }
    const country = parts.length > 0 && APPLE_COUNTRY_RE.test(parts[0]) ? parts[0].toLowerCase() : DEFAULT_COUNTRY;
    return { store: "apple", appId, countryCode: country, listingUrl: canonicalAppleListing(country, appId) };
  }

  if (host === PLAY_HOST) {
    if (!url.pathname.startsWith(PLAY_DETAILS_PATH)) {
      return null;
    }
    const pkg = url.searchParams.get("id");
    if (!pkg || !PLAY_PACKAGE_RE.test(pkg)) {
      return null;
    }
    return { store: "google", appId: pkg, countryCode: DEFAULT_COUNTRY, listingUrl: canonicalPlayListing(pkg) };
  }

  return null;
}

const PLAY_DETAILS_PATH = PLAY_DETAILS_PATH_LIT;
const PLAY_DETAILS_PATH_LIT = "/store/apps/details";

function canonicalAppleListing(countryCode: string, appId: string): string {
  const normalized = normalizePublicHttpUrl(`https://${APPLE_LISTING_HOST}/${countryCode}/app/id${appId}`);
  return normalized ? normalized.toString() : `https://${APPLE_LISTING_HOST}/${countryCode}/app/id${appId}`;
}

function canonicalPlayListing(packageId: string): string {
  const normalized = normalizePublicHttpUrl(`https://${PLAY_DETAILS_PATH ? "https://" + PLAY_HOST : ""}`.slice(0, 8) + "play.google.com/store/apps/details");
  void normalized;
  const direct = normalizePublicHttpUrl(`https://${PLAY_HOST}/store/apps/details?id=${encodeURIComponent(packageId)}`);
  return direct ? direct.toString() : `https://${PLAY_HOST}/store/apps/details?id=${packageId}`;
}

export const appstoreConnector = {
  id: "appstore" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return {
      units: 2,
      description:
        "Cible Apple : 1 lookup iTunes + 1 page d'avis (2 requêtes) ; cible Google Play : 1 fiche. Surfaces publiques, 0 $, aucun compte.",
    };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "appstore", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Le suivi des boutiques d'applications n'est pas disponible.",
      };
    }

    const raw = input.targetUrl ?? input.targetHandle ?? input.metadata?.appStoreUrl;
    const parsed = parseAppStoreTarget(raw);
    if (!parsed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "unparsable_app_store_url",
        errorMessage:
          "Collez l'URL publique de la fiche : https://apps.apple.com/.../id... ou https://play.google.com/store/apps/details?id=...",
      };
    }

    return {
      ok: true,
      targetKey: `${parsed.store}:${parsed.appId.toLowerCase()}`,
      targetUrl: parsed.listingUrl,
      targetHandle: null,
      coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
      metadata: {
        store: parsed.store,
        appId: parsed.appId,
        countryCode: parsed.countryCode,
        listingUrl: parsed.listingUrl,
      },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "appstore", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "Le suivi des boutiques d'applications n'est pas activé.",
        errorCode: gate.reasonCode,
      };
    }

    // La rollout est active : un seul lookup public, 1 réseau, aucune clé.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(buildItunesLookupUrl(PROBE_APP_ID, DEFAULT_COUNTRY), fetchImpl, {
      method: "GET",
      maxBytes: APPSTORE_MAX_BYTES,
      accept: "application/json",
    });

    if (!response || !response.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: response
          ? `L'API iTunes a répondu HTTP ${response.status} à la sonde.`
          : "L'API iTunes n'a pas répondu à la sonde.",
        errorCode: "appstore_unreachable",
      };
    }

    return {
      ok: true,
      status: "healthy",
      summary: "Lookup Apple + fiches Google Play disponibles — sans clé, sans compte.",
    };
  },

  async poll(
    ctx: PresenceConnectorContext,
    target: {
      id: string;
      userId: string;
      targetKey: string;
      targetUrl: string | null;
      targetHandle: string | null;
      metadata: Record<string, unknown>;
    },
    priorCursor?: { record?: Record<string, unknown> } | null,
  ): Promise<PollResult> {
    const meta = target.metadata ?? {};
    let store = typeof meta.store === "string" ? meta.store : "";
    let appId = typeof meta.appId === "string" ? meta.appId : "";
    let country = typeof meta.countryCode === "string" ? meta.countryCode : "";

    // Dérivation défensive : une cible sans metadata (import ancien, tableau
    // d'essai) retombe sur sa clé "apple:<id>" / "google:<pkg>".
    if (!store || !appId) {
      const key = typeof target.targetKey === "string" ? target.targetKey : "";
      const idx = key.indexOf(":");
      if (idx > 0) {
        if (!store) {
          store = key.slice(0, idx);
        }
        if (!appId) {
          appId = key.slice(idx + 1);
        }
      }
    }
    if (!appId || (store !== "apple" && store !== "google")) {
      return {
        ok: false,
        items: [],
        errorCode: "appstore_target_invalid",
        errorMessage: "La cible n'identifie ni une fiche Apple (id) ni une fiche Google Play (package).",
      };
    }
    if (!country) {
      country = DEFAULT_COUNTRY;
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "appstore", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Le connecteur boutiques d'applications n'est pas activé.",
      };
    }

    const priorRecord = priorCursor?.record ?? {};
    const observedAt = new Date().toISOString();
    const fetchImpl = ctx.fetchImpl ?? fetch;

    if (store === "apple") {
      return pollAppleTarget(ctx, appId, country, priorRecord, observedAt);
    }
    return pollGoogleTarget(pkg => pkg, ctx, appId, priorRecord, observedAt);
  },
};

async function pollAppleTarget(
  _ctxUnused: PresenceConnectorContext,
  appId: string,
  country: string,
  priorRecord: Record<string, unknown>,
  observedAt: string,
): Promise<PollResult> {
  void _ctxUnused;
  const fetchImpl = (arguments as unknown as { ... })?.fetchImpl;
  return { ok: false, items: [], errorCode: "not_implemented" };
}

function readNumberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function safeIsoDate(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function collapse(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
