const META_AD_LIBRARY = "https://www.facebook.com/ads/library/";
const GOOGLE_AD_TRANSPARENCY = "https://adstransparency.google.com/";

export function adLibraryLinks({ name, domain }: { name: string; domain: string }): { meta: string; google: string } {
  const meta = new URL(META_AD_LIBRARY);
  meta.searchParams.set("active_status", "active");
  meta.searchParams.set("ad_type", "all");
  meta.searchParams.set("country", "ALL");
  meta.searchParams.set("media_type", "all");
  meta.searchParams.set("search_type", "keyword_exact_phrase");
  meta.searchParams.set("q", `"${name}"`);

  const google = new URL(GOOGLE_AD_TRANSPARENCY);
  google.searchParams.set("region", "anywhere");
  google.searchParams.set("domain", domain);

  return { meta: meta.toString(), google: google.toString() };
}
