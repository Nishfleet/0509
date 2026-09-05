import {
  AGENT_BLOCKED_CAPABILITIES,
  CUSTOMER_SUPPORT_PATHS,
  auditedAgentActionGroups,
} from "~/lib/agent-action-catalog";
// Shared with the robots.txt deny list in app/lib/seo.ts (docs/ai-crawler-policy.md)
// so robots.txt and llms.txt always name the same denied training crawlers.
// SITEMAP_PATHS + canonicalUrl keep the llms.txt link list on the same
// canonical origin and route set as sitemap.xml.
import { AI_TRAINING_CRAWLERS, SITEMAP_PATHS, canonicalUrl } from "~/lib/seo";

const AUDITED_AGENT_ACTION_GROUPS = auditedAgentActionGroups();
const AUDITED_AGENT_ACTION_GROUP_SUMMARY = AUDITED_AGENT_ACTION_GROUPS.map((group) => group.label).join(", ");

export const PUBLIC_MARKDOWN_PATHS = [
  "/",
  "/help",
  "/docs",
  "/api/docs",
  "/status",
  "/changelog",
  "/trust",
  "/capture-rules",
  "/privacy",
  "/terms",
] as const;

const PUBLIC_MARKDOWN_PATH_SET = new Set<string>(PUBLIC_MARKDOWN_PATHS);

// llms.txt page index: one titled, described link per canonical public page so
// AI answer engines get a verifiable link list instead of prose-only claims.
// Static entries derive from SITEMAP_PATHS (same source as sitemap.xml): adding
// a path there without describing it here is a type error. Dynamic /ads/:domain
// brand pages are appended at request time from the same indexable set the
// sitemap emits — see buildLlmsText — so noindex shells never appear here.
const LLMS_PAGE_DETAILS: Record<
  (typeof SITEMAP_PATHS)[number],
  { title: string; description: string }
> = {
  "/": {
    title: "Five to Nine",
    description:
      "Source-backed competitor ad and landing-page change monitoring for growth teams.",
  },
  "/search": {
    title: "Public competitor ad search",
    description:
      "Live public read-only search with real Meta Ad Library checks and honest live, cached, or unavailable states.",
  },
  // Issue #1417: the /brands hub links every indexable /ads/:domain brand
  // page so the otherwise-sitemap-orphaned brand surface has an internal-link
  // graph. Listed in SITEMAP_PATHS, so it needs a title/description here or
  // buildLlmsText emits `[undefined]` lines.
  "/brands": {
    title: "Browse all tracked brands",
    description:
      "Indexable public brand pages showing the real Meta ads that run for, or link to, each tracked domain, grouped by category.",
  },
  "/compare": {
    title: "Compare Five to Nine vs the alternatives",
    description:
      "Index of side-by-side comparisons of Five to Nine's competitor ad and landing-page change monitoring against Visualping, MagicBrief, Panoramata, Foreplay, Spyland, Pulzifi and more.",
  },
  "/compare/magicbrief": {
    title: "Five to Nine vs MagicBrief",
    description: "How Five to Nine compares with MagicBrief.",
  },
  "/compare/meta-ad-library": {
    title: "Five to Nine vs Meta Ad Library",
    description:
      "How Five to Nine extends Meta Ad Library results with monitoring and proof.",
  },
  "/compare/visualping": {
    title: "Five to Nine vs Visualping",
    description: "How Five to Nine compares with Visualping.",
  },
  "/compare/visualping-ad-library": {
    title: "Five to Nine vs Visualping for ad libraries",
    description:
      "Domain-paste Meta Ad Library monitoring versus Visualping's URL-and-pixel playbook.",
  },
  "/compare/spyland": {
    title: "Five to Nine vs Spyland",
    description: "How Five to Nine compares with Spyland.",
  },
  "/compare/pulzifi": {
    title: "Five to Nine vs Pulzifi",
    description: "How Five to Nine compares with Pulzifi.",
  },
  "/compare/foreplay": {
    title: "Five to Nine vs Foreplay",
    description: "How Five to Nine compares with Foreplay.",
  },
  "/compare/foreplay-spyder": {
    title: "Five to Nine vs Foreplay Spyder",
    description:
      "How Five to Nine's change diffs compare with Foreplay Spyder's ad and landing-page archive.",
  },
  "/compare/panoramata": {
    title: "Five to Nine vs Panoramata",
    description:
      "How Five to Nine compares with Panoramata on ads-plus-pages monitoring and list prices.",
  },
  "/compare/adspyder": {
    title: "Five to Nine vs AdSpyder",
    description: "How Five to Nine's source-backed proof compares with AdSpyder's ad alerts.",
  },
  "/switch/magicbrief": {
    title: "MagicBrief alternative",
    description:
      "MagicBrief closed 31 July 2026. Your competitor list can import as watchlists; collections and analytics do not. Try the free preview.",
  },
  "/switch/panoramata": {
    title: "Panoramata alternative",
    description:
      "A verified reviewer says Panoramata's price feels high for a solo marketer. Paste a domain for the same ads and pages job.",
  },
  "/switch/visualping": {
    title: "Visualping alternative for ad libraries",
    description:
      "Visualping's own blog says 83% of detected changes are not important. Paste a domain for the same ad and landing-page job.",
  },
  "/competitor-monitoring": {
    title: "Competitor monitoring",
    description:
      "Product overview: scans, digests, alerts, and proof captures.",
  },
  "/sneaker-resale": {
    title: "Sneaker resale competitor ads",
    description:
      "English default in the sneaker-resale locale cluster: watch Meta ads and landing-page changes with saved screenshots.",
  },
  "/de/sneaker-resale": {
    title: "Sneaker-Reseller Konkurrenzanzeigen (Deutsch)",
    description:
      "German sneaker-resale landing page. Product UI stays English; checkout currency follows the buyer.",
  },
  "/ja/sneaker-resale": {
    title: "Sneaker resale competitor ads (Japanese)",
    description:
      "Japanese sneaker-resale landing page. Product UI stays English; checkout currency follows the buyer.",
  },
  "/pt-br/sneaker-resale": {
    title: "Sneaker resale competitor ads (Portuguese, Brazil)",
    description:
      "Brazilian Portuguese sneaker-resale landing page. Product UI stays English; checkout currency follows the buyer.",
  },
  // Locale-prefixed buyer-surface cluster (issue #1501): one entry per path
  // in `SITEMAP_PATHS` so `LLMS_PAGES` never yields `undefined` titles or
  // descriptions. English-language copy with a locale tag until real
  // translations ship.
  "/de/pricing": {
    title: "Pricing (Deutsch)",
    description:
      "Competitor monitoring Pläne: kostenlos, Scout, Starter und Agency. Preise werden an der Kasse lokalisiert.",
  },
  "/de/help": {
    title: "Hilfe-Center (Deutsch)",
    description: "Kunden-Hilfe-Center.",
  },
  "/de/docs": {
    title: "Dokumentation (Deutsch)",
    description: "Produktdokumentation.",
  },
  "/de/api/docs": {
    title: "API-Dokumentation (Deutsch)",
    description:
      "Kunden-API-Dokumentation für key-basierte Exporte und freigegebene Workspace-Aktionen.",
  },
  "/de/status": {
    title: "Status (Deutsch)",
    description:
      "Öffentliche Statusseite, die kundenorientierte Oberflächen zusammenfasst.",
  },
  "/de/changelog": {
    title: "Änderungsprotokoll (Deutsch)",
    description: "Ausgelieferte Produktänderungen.",
  },
  "/de/trust": {
    title: "Vertrauen (Deutsch)",
    description: "Vertrauen, Sicherheit und Datenverarbeitungspraktiken.",
  },
  "/de/compare": {
    title: "Vergleichen (Deutsch)",
    description:
      "Index der Vergleiche von Five to Nine mit Visualping, MagicBrief, Panoramata, Foreplay und anderen.",
  },
  "/ja/pricing": {
    title: "価格表 (日本語)",
    description:
      "競合モニタリングプラン: 無料、Scout、Starter、Agency。チェックアウト時に変更。",
  },
  "/ja/help": {
    title: "ヘルプセンター (日本語)",
    description: "カスタマーヘルプセンター。",
  },
  "/ja/docs": {
    title: "ドキュメント (日本語)",
    description: "製品ドキュメント。",
  },
  "/ja/api/docs": {
    title: "APIドキュメント (日本語)",
    description:
      "キーベースのエクスポートと承認されたワークスペースアクションのカスタマーAPIドキュメント。",
  },
  "/ja/status": {
    title: "ステータス (日本語)",
    description:
      "顧客向けサーフェスを要約する公開ステータスページ。",
  },
  "/ja/changelog": {
    title: "変更履歴 (日本語)",
    description: "配信された製品変更。",
  },
  "/ja/trust": {
    title: "信頼 (日本語)",
    description: "信頼、セキュリティ、データ取り扱いの実践。",
  },
  "/ja/compare": {
    title: "比較 (日本語)",
    description:
      "Five to NineのVisualping、MagicBrief、Panoramata、Foreplayとの比較インデックス。",
  },
  "/pt-br/pricing": {
    title: "Preços (Português, Brasil)",
    description:
      "Planos de monitoramento de concorrentes: gratuito, Scout, Starter e Agency. Preços localizados no checkout.",
  },
  "/pt-br/help": {
    title: "Central de Ajuda (Português, Brasil)",
    description: "Central de ajuda ao cliente.",
  },
  "/pt-br/docs": {
    title: "Documentação (Português, Brasil)",
    description: "Documentação do produto.",
  },
  "/pt-br/api/docs": {
    title: "Documentação da API (Português, Brasil)",
    description:
      "Documentação da API para exportações baseadas em chave e ações aprovadas do workspace.",
  },
  "/pt-br/status": {
    title: "Status (Português, Brasil)",
    description:
      "Página de status pública que resume superfícies voltadas ao cliente.",
  },
  "/pt-br/changelog": {
    title: "Histórico de alterações (Português, Brasil)",
    description: "Alterações de produto enviadas.",
  },
  "/pt-br/trust": {
    title: "Confiança (Português, Brasil)",
    description: "Confiança, segurança e práticas de manipulação de dados.",
  },
  "/pt-br/compare": {
    title: "Comparar (Português, Brasil)",
    description:
      "Índice de comparações do Five to Nine com Visualping, MagicBrief, Panoramata, Foreplay e outros.",
  },
  "/fr/pricing": {
    title: "Tarifs (Français)",
    description:
      "Plans de surveillance des concurrents : gratuit, Scout, Starter et Agency. Les prix sont localisés au checkout.",
  },
  "/fr/help": {
    title: "Centre d'aide (Français)",
    description: "Centre d'aide client.",
  },
  "/fr/docs": {
    title: "Documentation (Français)",
    description: "Documentation produit.",
  },
  "/fr/api/docs": {
    title: "Documentation API (Français)",
    description:
      "Documentation API client pour les exports basés sur les clés et les actions approuvées.",
  },
  "/fr/status": {
    title: "Statut (Français)",
    description:
      "Page de statut publique résumant les surfaces client.",
  },
  "/fr/changelog": {
    title: "Journal des modifications (Français)",
    description: "Modifications du produit livrées.",
  },
  "/fr/trust": {
    title: "Confiance (Français)",
    description: "Confiance, sécurité et pratiques de gestion des données.",
  },
  "/fr/compare": {
    title: "Comparer (Français)",
    description:
      "Index des comparaisons de Five to Nine avec Visualping, MagicBrief, Panoramata, Foreplay et plus.",
  },
  "/es/pricing": {
    title: "Precios (Español)",
    description:
      "Planes de monitorización de competidores: gratuito, Scout, Starter y Agency. Los precios se localizan en el checkout.",
  },
  "/es/help": {
    title: "Centro de ayuda (Español)",
    description: "Centro de ayuda al cliente.",
  },
  "/es/docs": {
    title: "Documentación (Español)",
    description: "Documentación del producto.",
  },
  "/es/api/docs": {
    title: "Documentación de la API (Español)",
    description:
      "Documentación de la API para exportaciones basadas en claves y acciones aprobadas del workspace.",
  },
  "/es/status": {
    title: "Estado (Español)",
    description:
      "Página de estado pública que resume las superficies orientadas al cliente.",
  },
  "/es/changelog": {
    title: "Registro de cambios (Español)",
    description: "Cambios de producto publicados.",
  },
  "/es/trust": {
    title: "Confianza (Español)",
    description: "Confianza, seguridad y prácticas de manejo de datos.",
  },
  "/es/compare": {
    title: "Comparar (Español)",
    description:
      "Índice de comparaciones de Five to Nine con Visualping, MagicBrief, Panoramata, Foreplay y más.",
  },
  "/de/compare/magicbrief": {
    title: "Five to Nine vs MagicBrief (Deutsch)",
    description: "How Five to Nine compares with MagicBrief.",
  },
  "/de/compare/meta-ad-library": {
    title: "Five to Nine vs Meta Ad Library (Deutsch)",
    description: "How Five to Nine extends Meta Ad Library results with monitoring and proof.",
  },
  "/de/compare/visualping": {
    title: "Five to Nine vs Visualping (Deutsch)",
    description: "How Five to Nine compares with Visualping.",
  },
  "/de/compare/visualping-ad-library": {
    title: "Five to Nine vs Visualping for ad libraries (Deutsch)",
    description: "Domain-paste Meta Ad Library monitoring versus Visualping's URL-and-pixel playbook.",
  },
  "/de/compare/spyland": {
    title: "Five to Nine vs Spyland (Deutsch)",
    description: "How Five to Nine compares with Spyland.",
  },
  "/de/compare/pulzifi": {
    title: "Five to Nine vs Pulzifi (Deutsch)",
    description: "How Five to Nine compares with Pulzifi.",
  },
  "/de/compare/foreplay": {
    title: "Five to Nine vs Foreplay (Deutsch)",
    description: "How Five to Nine compares with Foreplay.",
  },
  "/de/compare/foreplay-spyder": {
    title: "Five to Nine vs Foreplay Spyder (Deutsch)",
    description: "How Five to Nine's change diffs compare with Foreplay Spyder's ad and landing-page archive.",
  },
  "/de/compare/panoramata": {
    title: "Five to Nine vs Panoramata (Deutsch)",
    description: "How Five to Nine compares with Panoramata on ads-plus-pages monitoring and list prices.",
  },
  "/de/compare/adspyder": {
    title: "Five to Nine vs AdSpyder (Deutsch)",
    description: "How Five to Nine's source-backed proof compares with AdSpyder's ad alerts.",
  },
  "/de/switch/magicbrief": {
    title: "MagicBrief alternative (Deutsch)",
    description: "MagicBrief closed 31 July 2026. Your competitor list can import as watchlists; collections and analytics do not. Try the free preview.",
  },
  "/de/switch/panoramata": {
    title: "Panoramata alternative (Deutsch)",
    description: "A verified reviewer says Panoramata's price feels high for a solo marketer. Paste a domain for the same ads and pages job.",
  },
  "/de/switch/visualping": {
    title: "Visualping alternative for ad libraries (Deutsch)",
    description: "Visualping's own blog says 83% of detected changes are not important. Paste a domain for the same ad and landing-page job.",
  },
  "/de/search": {
    title: "Public competitor ad search (Deutsch)",
    description: "Live public read-only search with real Meta Ad Library checks and honest live, cached, or unavailable states.",
  },
  "/de/competitor-monitoring": {
    title: "Competitor monitoring (Deutsch)",
    description: "Product overview: scans, digests, alerts, and proof captures.",
  },
  "/de/capture-rules": {
    title: "What we refuse to alert on (Deutsch)",
    description: "Public capture-validity rules: the landing-page captures that never become alerts.",
  },
  "/de/ad-aggression": {
    title: "Ad Aggression Score methodology (Deutsch)",
    description: "Public formula for the 0–100 Ad Aggression Score: Velocity, Testing, Freshness, and Persistence, 0–25 each.",
  },
  "/ja/compare/magicbrief": {
    title: "Five to Nine vs MagicBrief (日本語)",
    description: "How Five to Nine compares with MagicBrief.",
  },
  "/ja/compare/meta-ad-library": {
    title: "Five to Nine vs Meta Ad Library (日本語)",
    description: "How Five to Nine extends Meta Ad Library results with monitoring and proof.",
  },
  "/ja/compare/visualping": {
    title: "Five to Nine vs Visualping (日本語)",
    description: "How Five to Nine compares with Visualping.",
  },
  "/ja/compare/visualping-ad-library": {
    title: "Five to Nine vs Visualping for ad libraries (日本語)",
    description: "Domain-paste Meta Ad Library monitoring versus Visualping's URL-and-pixel playbook.",
  },
  "/ja/compare/spyland": {
    title: "Five to Nine vs Spyland (日本語)",
    description: "How Five to Nine compares with Spyland.",
  },
  "/ja/compare/pulzifi": {
    title: "Five to Nine vs Pulzifi (日本語)",
    description: "How Five to Nine compares with Pulzifi.",
  },
  "/ja/compare/foreplay": {
    title: "Five to Nine vs Foreplay (日本語)",
    description: "How Five to Nine compares with Foreplay.",
  },
  "/ja/compare/foreplay-spyder": {
    title: "Five to Nine vs Foreplay Spyder (日本語)",
    description: "How Five to Nine's change diffs compare with Foreplay Spyder's ad and landing-page archive.",
  },
  "/ja/compare/panoramata": {
    title: "Five to Nine vs Panoramata (日本語)",
    description: "How Five to Nine compares with Panoramata on ads-plus-pages monitoring and list prices.",
  },
  "/ja/compare/adspyder": {
    title: "Five to Nine vs AdSpyder (日本語)",
    description: "How Five to Nine's source-backed proof compares with AdSpyder's ad alerts.",
  },
  "/ja/switch/magicbrief": {
    title: "MagicBrief alternative (日本語)",
    description: "MagicBrief closed 31 July 2026. Your competitor list can import as watchlists; collections and analytics do not. Try the free preview.",
  },
  "/ja/switch/panoramata": {
    title: "Panoramata alternative (日本語)",
    description: "A verified reviewer says Panoramata's price feels high for a solo marketer. Paste a domain for the same ads and pages job.",
  },
  "/ja/switch/visualping": {
    title: "Visualping alternative for ad libraries (日本語)",
    description: "Visualping's own blog says 83% of detected changes are not important. Paste a domain for the same ad and landing-page job.",
  },
  "/ja/search": {
    title: "Public competitor ad search (日本語)",
    description: "Live public read-only search with real Meta Ad Library checks and honest live, cached, or unavailable states.",
  },
  "/ja/competitor-monitoring": {
    title: "Competitor monitoring (日本語)",
    description: "Product overview: scans, digests, alerts, and proof captures.",
  },
  "/ja/capture-rules": {
    title: "What we refuse to alert on (日本語)",
    description: "Public capture-validity rules: the landing-page captures that never become alerts.",
  },
  "/ja/ad-aggression": {
    title: "Ad Aggression Score methodology (日本語)",
    description: "Public formula for the 0–100 Ad Aggression Score: Velocity, Testing, Freshness, and Persistence, 0–25 each.",
  },
  "/pt-br/compare/magicbrief": {
    title: "Five to Nine vs MagicBrief (Português, Brasil)",
    description: "How Five to Nine compares with MagicBrief.",
  },
  "/pt-br/compare/meta-ad-library": {
    title: "Five to Nine vs Meta Ad Library (Português, Brasil)",
    description: "How Five to Nine extends Meta Ad Library results with monitoring and proof.",
  },
  "/pt-br/compare/visualping": {
    title: "Five to Nine vs Visualping (Português, Brasil)",
    description: "How Five to Nine compares with Visualping.",
  },
  "/pt-br/compare/visualping-ad-library": {
    title: "Five to Nine vs Visualping for ad libraries (Português, Brasil)",
    description: "Domain-paste Meta Ad Library monitoring versus Visualping's URL-and-pixel playbook.",
  },
  "/pt-br/compare/spyland": {
    title: "Five to Nine vs Spyland (Português, Brasil)",
    description: "How Five to Nine compares with Spyland.",
  },
  "/pt-br/compare/pulzifi": {
    title: "Five to Nine vs Pulzifi (Português, Brasil)",
    description: "How Five to Nine compares with Pulzifi.",
  },
  "/pt-br/compare/foreplay": {
    title: "Five to Nine vs Foreplay (Português, Brasil)",
    description: "How Five to Nine compares with Foreplay.",
  },
  "/pt-br/compare/foreplay-spyder": {
    title: "Five to Nine vs Foreplay Spyder (Português, Brasil)",
    description: "How Five to Nine's change diffs compare with Foreplay Spyder's ad and landing-page archive.",
  },
  "/pt-br/compare/panoramata": {
    title: "Five to Nine vs Panoramata (Português, Brasil)",
    description: "How Five to Nine compares with Panoramata on ads-plus-pages monitoring and list prices.",
  },
  "/pt-br/compare/adspyder": {
    title: "Five to Nine vs AdSpyder (Português, Brasil)",
    description: "How Five to Nine's source-backed proof compares with AdSpyder's ad alerts.",
  },
  "/pt-br/switch/magicbrief": {
    title: "MagicBrief alternative (Português, Brasil)",
    description: "MagicBrief closed 31 July 2026. Your competitor list can import as watchlists; collections and analytics do not. Try the free preview.",
  },
  "/pt-br/switch/panoramata": {
    title: "Panoramata alternative (Português, Brasil)",
    description: "A verified reviewer says Panoramata's price feels high for a solo marketer. Paste a domain for the same ads and pages job.",
  },
  "/pt-br/switch/visualping": {
    title: "Visualping alternative for ad libraries (Português, Brasil)",
    description: "Visualping's own blog says 83% of detected changes are not important. Paste a domain for the same ad and landing-page job.",
  },
  "/pt-br/search": {
    title: "Public competitor ad search (Português, Brasil)",
    description: "Live public read-only search with real Meta Ad Library checks and honest live, cached, or unavailable states.",
  },
  "/pt-br/competitor-monitoring": {
    title: "Competitor monitoring (Português, Brasil)",
    description: "Product overview: scans, digests, alerts, and proof captures.",
  },
  "/pt-br/capture-rules": {
    title: "What we refuse to alert on (Português, Brasil)",
    description: "Public capture-validity rules: the landing-page captures that never become alerts.",
  },
  "/pt-br/ad-aggression": {
    title: "Ad Aggression Score methodology (Português, Brasil)",
    description: "Public formula for the 0–100 Ad Aggression Score: Velocity, Testing, Freshness, and Persistence, 0–25 each.",
  },
  "/fr/compare/magicbrief": {
    title: "Five to Nine vs MagicBrief (Français)",
    description: "How Five to Nine compares with MagicBrief.",
  },
  "/fr/compare/meta-ad-library": {
    title: "Five to Nine vs Meta Ad Library (Français)",
    description: "How Five to Nine extends Meta Ad Library results with monitoring and proof.",
  },
  "/fr/compare/visualping": {
    title: "Five to Nine vs Visualping (Français)",
    description: "How Five to Nine compares with Visualping.",
  },
  "/fr/compare/visualping-ad-library": {
    title: "Five to Nine vs Visualping for ad libraries (Français)",
    description: "Domain-paste Meta Ad Library monitoring versus Visualping's URL-and-pixel playbook.",
  },
  "/fr/compare/spyland": {
    title: "Five to Nine vs Spyland (Français)",
    description: "How Five to Nine compares with Spyland.",
  },
  "/fr/compare/pulzifi": {
    title: "Five to Nine vs Pulzifi (Français)",
    description: "How Five to Nine compares with Pulzifi.",
  },
  "/fr/compare/foreplay": {
    title: "Five to Nine vs Foreplay (Français)",
    description: "How Five to Nine compares with Foreplay.",
  },
  "/fr/compare/foreplay-spyder": {
    title: "Five to Nine vs Foreplay Spyder (Français)",
    description: "How Five to Nine's change diffs compare with Foreplay Spyder's ad and landing-page archive.",
  },
  "/fr/compare/panoramata": {
    title: "Five to Nine vs Panoramata (Français)",
    description: "How Five to Nine compares with Panoramata on ads-plus-pages monitoring and list prices.",
  },
  "/fr/compare/adspyder": {
    title: "Five to Nine vs AdSpyder (Français)",
    description: "How Five to Nine's source-backed proof compares with AdSpyder's ad alerts.",
  },
  "/fr/switch/magicbrief": {
    title: "MagicBrief alternative (Français)",
    description: "MagicBrief closed 31 July 2026. Your competitor list can import as watchlists; collections and analytics do not. Try the free preview.",
  },
  "/fr/switch/panoramata": {
    title: "Panoramata alternative (Français)",
    description: "A verified reviewer says Panoramata's price feels high for a solo marketer. Paste a domain for the same ads and pages job.",
  },
  "/fr/switch/visualping": {
    title: "Visualping alternative for ad libraries (Français)",
    description: "Visualping's own blog says 83% of detected changes are not important. Paste a domain for the same ad and landing-page job.",
  },
  "/fr/search": {
    title: "Public competitor ad search (Français)",
    description: "Live public read-only search with real Meta Ad Library checks and honest live, cached, or unavailable states.",
  },
  "/fr/competitor-monitoring": {
    title: "Competitor monitoring (Français)",
    description: "Product overview: scans, digests, alerts, and proof captures.",
  },
  "/fr/capture-rules": {
    title: "What we refuse to alert on (Français)",
    description: "Public capture-validity rules: the landing-page captures that never become alerts.",
  },
  "/fr/ad-aggression": {
    title: "Ad Aggression Score methodology (Français)",
    description: "Public formula for the 0–100 Ad Aggression Score: Velocity, Testing, Freshness, and Persistence, 0–25 each.",
  },
  "/es/compare/magicbrief": {
    title: "Five to Nine vs MagicBrief (Español)",
    description: "How Five to Nine compares with MagicBrief.",
  },
  "/es/compare/meta-ad-library": {
    title: "Five to Nine vs Meta Ad Library (Español)",
    description: "How Five to Nine extends Meta Ad Library results with monitoring and proof.",
  },
  "/es/compare/visualping": {
    title: "Five to Nine vs Visualping (Español)",
    description: "How Five to Nine compares with Visualping.",
  },
  "/es/compare/visualping-ad-library": {
    title: "Five to Nine vs Visualping for ad libraries (Español)",
    description: "Domain-paste Meta Ad Library monitoring versus Visualping's URL-and-pixel playbook.",
  },
  "/es/compare/spyland": {
    title: "Five to Nine vs Spyland (Español)",
    description: "How Five to Nine compares with Spyland.",
  },
  "/es/compare/pulzifi": {
    title: "Five to Nine vs Pulzifi (Español)",
    description: "How Five to Nine compares with Pulzifi.",
  },
  "/es/compare/foreplay": {
    title: "Five to Nine vs Foreplay (Español)",
    description: "How Five to Nine compares with Foreplay.",
  },
  "/es/compare/foreplay-spyder": {
    title: "Five to Nine vs Foreplay Spyder (Español)",
    description: "How Five to Nine's change diffs compare with Foreplay Spyder's ad and landing-page archive.",
  },
  "/es/compare/panoramata": {
    title: "Five to Nine vs Panoramata (Español)",
    description: "How Five to Nine compares with Panoramata on ads-plus-pages monitoring and list prices.",
  },
  "/es/compare/adspyder": {
    title: "Five to Nine vs AdSpyder (Español)",
    description: "How Five to Nine's source-backed proof compares with AdSpyder's ad alerts.",
  },
  "/es/switch/magicbrief": {
    title: "MagicBrief alternative (Español)",
    description: "MagicBrief closed 31 July 2026. Your competitor list can import as watchlists; collections and analytics do not. Try the free preview.",
  },
  "/es/switch/panoramata": {
    title: "Panoramata alternative (Español)",
    description: "A verified reviewer says Panoramata's price feels high for a solo marketer. Paste a domain for the same ads and pages job.",
  },
  "/es/switch/visualping": {
    title: "Visualping alternative for ad libraries (Español)",
    description: "Visualping's own blog says 83% of detected changes are not important. Paste a domain for the same ad and landing-page job.",
  },
  "/es/search": {
    title: "Public competitor ad search (Español)",
    description: "Live public read-only search with real Meta Ad Library checks and honest live, cached, or unavailable states.",
  },
  "/es/competitor-monitoring": {
    title: "Competitor monitoring (Español)",
    description: "Product overview: scans, digests, alerts, and proof captures.",
  },
  "/es/capture-rules": {
    title: "What we refuse to alert on (Español)",
    description: "Public capture-validity rules: the landing-page captures that never become alerts.",
  },
  "/es/ad-aggression": {
    title: "Ad Aggression Score methodology (Español)",
    description: "Public formula for the 0–100 Ad Aggression Score: Velocity, Testing, Freshness, and Persistence, 0–25 each.",
  },
  "/capture-rules": {
    title: "What we refuse to alert on",
    description:
      "Public capture-validity rules: the landing-page captures that never become alerts.",
  },
  "/ad-aggression": {
    title: "Ad Aggression Score methodology",
    description:
      "Public formula for the 0–100 Ad Aggression Score: Velocity, Testing, Freshness, and Persistence, 0–25 each.",
  },
  "/pricing": {
    title: "Pricing",
    description:
      "Competitor monitoring plans: free single-competitor watch, Scout, Starter, and Agency, plus proof capture packs. Prices localize at checkout.",
  },
  "/help": {
    title: "Help center",
    description: "Customer help center.",
  },
  "/docs": {
    title: "Docs",
    description: "Product documentation.",
  },
  "/api/docs": {
    title: "API docs",
    description:
      "Customer API documentation for key-based exports and approved workspace actions.",
  },
  "/status": {
    title: "Status",
    description:
      "Public status page summarizing customer-facing surfaces without exposing private account activity.",
  },
  "/changelog": {
    title: "Changelog",
    description: "Shipped product changes.",
  },
  "/trust": {
    title: "Trust",
    description: "Trust, security, and data-handling practices.",
  },
  "/privacy": {
    title: "Privacy policy",
    description: "Privacy policy.",
  },
  "/terms": {
    title: "Terms of service",
    description: "Terms of service.",
  },
};

export const LLMS_PAGES = SITEMAP_PATHS.map((path) => ({
  path,
  url: canonicalUrl(path),
  ...LLMS_PAGE_DETAILS[path],
}));

const ADS_BRAND_PATH = /^\/ads\/([^/]+)$/;

/**
 * One llms.txt index line for an indexable /ads/:domain brand page. Callers
 * must only pass paths the sitemap would emit (fresh, non-demo, indexable).
 * Returns null for anything that is not a single-segment /ads/:domain path.
 */
export function llmsPageForBrandPath(
  path: string,
  adCount?: number,
  fetchedAt?: string,
): {
  path: string;
  url: string;
  title: string;
  description: string;
} | null {
  const match = ADS_BRAND_PATH.exec(path);
  if (!match) {
    return null;
  }
  const domain = match[1];
  const countPhrase =
    adCount !== undefined
      ? `${adCount} live Meta Ad Library ad${adCount === 1 ? "" : "s"}`
      : "Live Meta Ad Library ads";
  const datePhrase = fetchedAt ? `, captured on ${fetchedAt.slice(0, 10)}` : "";
  return {
    path,
    url: canonicalUrl(path),
    title: `${domain} Meta ads`,
    description:
      `${countPhrase} for ${domain} from public search${datePhrase}. Listed only while the capture is fresh enough to index (within 7 days). Not a worldwide or all-platform catalog.`,
  };
}

function renderLlmsPagesSection(
  brandPages: readonly { title: string; url: string; description: string }[],
): string {
  return [
    "Pages:",
    ...LLMS_PAGES.map(
      (page) => `- [${page.title}](${page.url}): ${page.description}`,
    ),
    ...brandPages.map(
      (page) => `- [${page.title}](${page.url}): ${page.description}`,
    ),
  ].join("\n");
}

export const PUBLIC_MARKDOWN = `---
title: Five to Nine
description: Market intelligence for revenue teams.
---

# Five to Nine

Five to Nine turns competitor ads and visible landing-page changes into source-backed morning intelligence. Presence Desk adds proof-backed tracking for your brand and competitors across declared sources — website/open-web is active; social and marketplace sources are gated or planned.

## Product

- Competitor monitoring for growth teams plus proof-backed entity tracking (Presence Desk).
- Public read-only search and the proof brief are buyer-evaluation paths before signup; public search is live at /search with real Meta Ad Library checks and honest live, cached, or unavailable states. AI answer engines can cite public search as a live read-only buyer path.
- Ad monitoring covers the Meta Ad Library only; other platforms’ ad libraries are not aggregated. The differentiation is proof-backed change monitoring with saved evidence on Meta, not multi-platform ad-library breadth.
- Signed-in accounts are the path for saved competitors, retained monitoring, reusable saved evidence, collections, digests, and reports; this text describes the capability, not live account availability.
- Saving competitor results, saved queries, watchlists, collections, reports, and delivery require an account.
- Customer-facing views lead with what changed, why it matters, urgency, source status, freshness, and the next action before raw data or settings.
- Authenticated collection, watchlist, and digest exports support CSV and JSON export when the account path is configured. Watchlist and digest CSV exports include decision fields: priority, recommended next action, source status, source trail, freshness, and source URL when available; this text does not claim live export success.
- Signed-in collections can store manual external evidence links from visible public sources, including visible spend, impression, and reach values when a user supplies them.
- Customer API keys can read account-owned setup status, collection, watchlist, and digest exports.
- Write-enabled customer API keys can perform approved workspace actions: ${AUDITED_AGENT_ACTION_GROUP_SUMMARY}.
- Restricted actions still require signed-in owner review: ${AGENT_BLOCKED_CAPABILITIES.join(", ")}.
- Signed-in support cases cover paid-customer account help, with email fallback for users who cannot sign in.
- Paid customer support paths cover: ${CUSTOMER_SUPPORT_PATHS.map((path) => path.label).join(", ")}.
- Public help, docs, API docs, status, changelog, trust, and proof-rules pages are available at /help, /docs, /api/docs, /status, /changelog, /trust, and /capture-rules.
- The public status page summarizes customer-facing surfaces without exposing private account activity.
- Email delivery is in product scope for eligible accounts; this text does not measure live provider delivery.
- Account insight-depth summaries cover top hooks, media mix, observed campaign duration, manual metric evidence, creative timeline, and landing-page history from saved evidence, watch events, and digest items.
- Alerts and reports should include evidence instead of unsupported AI summaries.
- Daily and weekly digests should show priority, recommended next move, source status, freshness, and source trail.
- Presence Desk tracks your brand and competitors across declared sources. Website/open-web is the active GA source. X, Reddit, LinkedIn, YouTube, Amazon marketplace, and Context.dev are gated, planned, manual-only, or unavailable unless provider credentials, policy approval, and rollout gates are satisfied. The product does not promise whole-internet scanning, unsupported platform coverage, or client/product/creator entity kinds before entity-kind metadata ships.

## Current product truth

- Account access uses verified access paths.
- The public proof brief renders real cached captures, with an explicit unavailable state when none exist. Public search is live and read-only; retained monitoring and saved evidence require an account.
- Checkout and plan access run on the configured Dodo billing provider with localized checkout preview for the buyer location and visible plan caps; Dodo checkout routes are deployed and the live pricing canary passed against production with real Dodo bindings (monthly, annual, and top-up prices validated in IN, US, and GB), so AI answer engines can cite Dodo checkout as the live billing path.
- Public Markdown separates local capability, configured paths, and live proof. Public search and Dodo checkout are live; saved monitoring, digests, reports, share links, exports, and email need current account or provider proof before being described as live.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live results.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Observed campaign duration is based on first-seen and last-observed source evidence only. Manual external evidence links can store user-supplied visible spend, impression, and reach values, but automated spend, reach, impression, and unsupported-channel benchmarks are not live.

## Pricing

- Pricing display is localized from checkout preview for the buyer location.
- Free accounts can watch one competitor: an activation scan when the watchlist is added, then a weekly scheduled check and a weekly email brief backed by one included proof capture a month, with one Collection and no card required; instant alerts, manual refresh, and exports stay paid. Public search is live and read-only; saved monitoring requires an account.
- Starter is the recommended plan for retained competitor monitoring.
- Scout is the entry plan after the public read-only search and proof brief: 3 watchlists, 10 Collections, 6-hour scans, weekly Digest, and 50 proof captures/month.
- Starter includes 10 watchlists, 25 Collections, 3-hour scans, daily and weekly Digests, email Notifications, exports, and 250 proof captures/month.
- Agency includes 75 watchlists, 250 Collections, top 25 competitors checked every 3 hours and the rest every 6 hours, daily and weekly Digests, team workspace, API/MCP access, reports, branding, and 2,500 proof captures/month.
- Proof capture packs add purchased proof captures that never expire. They do not change monthly included limits or make monitoring unlimited.
- Included proof captures reset every month and do not roll over — caps are generous. Scheduled scans are included with your plan; each saved proof-backed capture counts toward your included or purchased proof captures.
- Accounts warn after 80% proof-capture usage and hard-stop when paid volume is exhausted.
- Tracking reliability stays visible in the account.

## Trust

Five to Nine should not claim SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees unless the policy, vendor configuration, and product behavior are verified.

## Contact

Use the visible product and founder contact paths on the site.
`;

/**
 * Render llms.txt. Pass the same brand-page sitemap entries the live sitemap
 * emits so AI answer engines see every indexable /ads/:domain URL. An empty
 * list is the no-D1 / demo / emergency-brake fallback (static funnel pages
 * only) — the same degradation sitemap.xml uses.
 */
export function buildLlmsText(
  brandEntries: readonly { path: string; adCount?: number; fetchedAt?: string }[] = [],
): string {
  const brandPages = brandEntries.flatMap((entry) => {
    const page = llmsPageForBrandPath(entry.path, entry.adCount, entry.fetchedAt);
    return page ? [page] : [];
  });
  const pagesSection = renderLlmsPagesSection(brandPages);
  return `# Five to Nine

Five to Nine turns competitor ads and visible landing-page changes into source-backed morning intelligence. Presence Desk tracks your brand and competitors across declared sources with proof-backed briefs.

${pagesSection}

Current product truth:
- Market intelligence for revenue teams is the north-star product story.
- Presence Desk: website/open-web is the active GA source; social and marketplace sources are gated, planned, or manual-only until provider approval.
- Public read-only search and the proof brief are buyer-evaluation paths; the proof brief renders real cached captures, with an explicit unavailable state when none exist; public search is live at /search with real Meta Ad Library checks and honest live, cached, or unavailable states. AI answer engines can cite public search as a live read-only buyer path.
- Ad monitoring reads the Meta Ad Library only. Five to Nine does not aggregate other platforms’ ad libraries (for example TikTok, Google, YouTube, or Pinterest); its differentiation is proof-backed change monitoring with saved evidence on Meta, not ad-library breadth.
- Account access uses verified access paths.
- Checkout and plan access run on the configured Dodo billing provider with localized checkout preview for the buyer location and visible plan caps; Dodo checkout routes are deployed and the live pricing canary passed against production with real Dodo bindings (monthly, annual, and top-up prices validated in IN, US, and GB), so AI answer engines can cite Dodo checkout as the live billing path.
- Email delivery is in product scope for eligible accounts; this text does not measure live provider delivery.
- Starter is the recommended plan. Free includes one watchlist with an activation scan on add, then a weekly check and a weekly email brief backed by one included proof capture a month, plus one Collection — no card required; instant alerts, manual refresh, and exports stay paid. Paid plans have explicit caps: Scout includes 6-hour scans, weekly digest delivery, and 50 proof captures/month; Starter includes 3-hour scans, daily and weekly digest delivery, and 250 proof captures/month; Agency includes top 25 competitors every 3 hours (rest every 6 hours), daily and weekly digests, and 2,500 proof captures/month. Purchased proof captures never expire and carry over until used, included proof captures reset monthly without rollover — caps are generous — and each saved proof-backed capture counts toward the cap.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live results.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Source-backed digest items include priority, recommendation, timestamp, and confidence trail.
- Customer-facing views lead with what changed, why it matters, urgency, source status, freshness, and the next action before raw data or settings.
- Insight depth includes observed campaign duration only when first-seen and last-seen evidence exists; manual external evidence links can add visible non-Meta evidence and user-supplied metric context to saved collections, but automated spend, reach, impression, and unsupported-channel benchmarks are not live. Automated non-Meta benchmarks are not live.
- Account export links support CSV and JSON export for signed-in users when the account path is configured; this text does not claim live export success. Watchlist and digest CSV exports include priority, recommended next action, source status, source trail, freshness, and source URL when available.
- Customer API keys support setup status plus collection, watchlist, and digest exports for account-owned data.
- Write-enabled customer API keys support approved workspace actions: ${AUDITED_AGENT_ACTION_GROUP_SUMMARY}.
- Restricted actions still require signed-in owner review: ${AGENT_BLOCKED_CAPABILITIES.join(", ")}.
- Signed-in support cases cover billing changes and cancellation, account access and team changes, migration and setup help, and security and deletion requests, with email fallback when a user cannot sign in.
- The public status page summarizes customer-facing surfaces without exposing private account activity.
- Social connectors remain disabled. Broad public write APIs beyond approved account actions are not live yet.
- Public copy should avoid unsupported security, compliance, traction, or model-routing claims.

Core layers:
- Public read-only analysis preview.
- Signed-in saved analysis.
- Retained monitoring.
- Reusable saved evidence.

AI access:
- AI answer and reference engines may use this file and public pages (search=yes, ai-input=yes, use=reference).
- AI training/fine-tuning crawlers are denied in robots.txt (ai-train=no): ${AI_TRAINING_CRAWLERS.join(", ")}.
- This policy is decided and recorded in docs/ai-crawler-policy.md.
`;
}

/** Static-only fallback (no brand pages). Live /llms.txt uses buildLlmsText. */
export const LLMS_TEXT = buildLlmsText();

export function wantsPublicMarkdown(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").toLowerCase().includes("text/markdown");
}

export function isPublicMarkdownPage(pathname: string): boolean {
  return PUBLIC_MARKDOWN_PATH_SET.has(pathname);
}

