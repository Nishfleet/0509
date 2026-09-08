// Country catalog for ad discovery. Canonical values are full English names
// because saved-query fingerprints already hash them ("India") — switching
// canon to ISO codes would re-fingerprint every existing watchlist. ISO-2
// codes exist for the Meta Ad Library URL and for cf-ipcountry geo defaults.
export interface SupportedCountry {
  code: string;
  name: string;
}

export const ALL_COUNTRIES_VALUE = "all";

export const SUPPORTED_COUNTRIES: SupportedCountry[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "IE", name: "Ireland" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "AR", name: "Argentina" },
  { code: "CO", name: "Colombia" },
  { code: "CL", name: "Chile" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "IL", name: "Israel" },
  { code: "TR", name: "Turkey" },
  { code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },
  { code: "EG", name: "Egypt" },
  { code: "KE", name: "Kenya" },
  { code: "SG", name: "Singapore" },
  { code: "MY", name: "Malaysia" },
  { code: "ID", name: "Indonesia" },
  { code: "PH", name: "Philippines" },
  { code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "PK", name: "Pakistan" },
  { code: "BD", name: "Bangladesh" },
  { code: "LK", name: "Sri Lanka" },
  { code: "NZ", name: "New Zealand" },
];

const NAME_ALIASES: Record<string, string> = {
  usa: "United States",
  us: "United States",
  uk: "United Kingdom",
  uae: "United Arab Emirates",
};

const byCode = new Map(SUPPORTED_COUNTRIES.map((c) => [c.code, c]));
const byLowerName = new Map(SUPPORTED_COUNTRIES.map((c) => [c.name.toLowerCase(), c]));

export function countryNameFromIso(code: string | null | undefined): string | null {
  if (!code) return null;
  return byCode.get(code.trim().toUpperCase())?.name ?? null;
}

export function isoFromCountryName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.toLowerCase() === ALL_COUNTRIES_VALUE) return "ALL";
  const aliased = NAME_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  const match = byLowerName.get(aliased.toLowerCase());
  if (match) return match.code;
  // Already an ISO-2 code (legacy callers occasionally pass codes through).
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

// Visitor-geo default: cf-ipcountry → catalog name, else "all". Never a
// hardcoded single-country default — Five to Nine is global-first.
export function defaultCountryForVisitor(isoCode: string | null | undefined): string {
  return countryNameFromIso(isoCode) ?? ALL_COUNTRIES_VALUE;
}
