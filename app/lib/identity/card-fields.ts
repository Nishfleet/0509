export interface SiteFields {
  name: string | null;
  description: string | null;
  socials: { platform: string; url: string }[];
  unfound: boolean;
}
