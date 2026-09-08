export type SearchMode = "advertiser" | "keyword";

export type SearchFilters = {
  country: string;
  creativeType: "all" | "image" | "video" | "carousel";
  platform: string;
  query: string;
  status: "all" | "active" | "paused";
};

export type AdRecord = {
  id: string;
  advertiser: string;
  angleTags: string[];
  copy: string;
  countries: string[];
  creativeType: "image" | "video" | "carousel";
  cta: string;
  firstSeen: string;
  hook: string;
  keywords: string[];
  landingPage: string;
  lastSeen: string;
  platforms: string[];
  preview: {
    accent: string;
    badge: string;
    headline: string;
    subhead: string;
  };
  researchNote: string;
  status: "active" | "paused";
};

export const searchModes: SearchMode[] = ["advertiser", "keyword"];

export const countries = [
  { label: "All countries", value: "all" },
  { label: "United States", value: "United States" },
  { label: "United Kingdom", value: "United Kingdom" },
  { label: "India", value: "India" },
  { label: "Canada", value: "Canada" },
  { label: "Australia", value: "Australia" },
];

export const platforms = [
  { label: "All platforms", value: "all" },
  { label: "Facebook", value: "Facebook" },
  { label: "Instagram", value: "Instagram" },
  { label: "Messenger", value: "Messenger" },
];

export const creativeTypes = [
  { label: "All creative types", value: "all" },
  { label: "Image", value: "image" },
  { label: "Video", value: "video" },
  { label: "Carousel", value: "carousel" },
];

export const demoAds: AdRecord[] = [
  {
    id: "motiondesk-retention",
    advertiser: "MotionDesk",
    angleTags: ["Free trial", "Ops clarity", "Retention"],
    copy:
      "Campaign pacing, spend movement, and return alerts in one place for smaller media teams.",
    countries: ["United States", "Canada"],
    creativeType: "video",
    cta: "Start free trial",
    firstSeen: "Feb 26",
    hook: "See which campaigns are slipping before the weekly report lands.",
    keywords: ["retention", "free trial", "campaign monitoring", "media buyer"],
    landingPage: "https://motiondesk.example.com/trial",
    lastSeen: "Mar 13",
    platforms: ["Instagram", "Facebook"],
    preview: {
      accent: "#0f8b7f",
      badge: "Video creative",
      headline: "Weekly pacing is too late.",
      subhead: "Catch spend drift before it becomes a postmortem.",
    },
    researchNote:
      "Strong urgency angle. Ad is built around ops anxiety, not feature depth.",
    status: "active",
  },
  {
    id: "sienna-skin-spf",
    advertiser: "Sienna Skin",
    angleTags: ["Dermatologist-led", "SPF 50", "Bundle"],
    copy:
      "A daily mineral SPF positioned as the no-pill, no-flashback option for makeup wearers.",
    countries: ["United States", "United Kingdom", "Australia"],
    creativeType: "image",
    cta: "Shop now",
    firstSeen: "Jan 18",
    hook: "A mineral SPF that does not punish your morning routine.",
    keywords: ["spf 50", "mineral sunscreen", "beauty", "bundle"],
    landingPage: "https://siennaskin.example.com/daily-spf",
    lastSeen: "Mar 12",
    platforms: ["Instagram", "Facebook"],
    preview: {
      accent: "#d37d55",
      badge: "Static image",
      headline: "No cast. No pilling.",
      subhead: "Sun care for people who already know what bad SPF feels like.",
    },
    researchNote:
      "Beauty positioning is pain-relief first. Product proof is concise and visual.",
    status: "active",
  },
  {
    id: "ledgerloop-close",
    advertiser: "LedgerLoop",
    angleTags: ["Close faster", "Finance ops", "Checklist"],
    copy:
      "Month-end close software framed around fewer spreadsheet handoffs and better ownership.",
    countries: ["United States", "United Kingdom"],
    creativeType: "carousel",
    cta: "Book demo",
    firstSeen: "Feb 03",
    hook: "Your close process should not depend on memory and Slack pings.",
    keywords: ["finance ops", "close faster", "accounting workflow", "book demo"],
    landingPage: "https://ledgerloop.example.com/close",
    lastSeen: "Mar 10",
    platforms: ["Facebook", "Messenger"],
    preview: {
      accent: "#6a73ff",
      badge: "Carousel",
      headline: "Close in three days.",
      subhead: "Replace spreadsheet chaos with owned workflows.",
    },
    researchNote:
      "B2B finance messaging leans on process embarrassment and shorter close windows.",
    status: "active",
  },
  {
    id: "parcelpilot-sync",
    advertiser: "ParcelPilot",
    angleTags: ["Inventory sync", "Multi-channel", "Low stock"],
    copy:
      "Operations software for shops that need stock levels and shipping promises to stay aligned.",
    countries: ["India", "United States"],
    creativeType: "video",
    cta: "See how it works",
    firstSeen: "Feb 11",
    hook: "Inventory sync stops being optional once every storefront starts drifting.",
    keywords: ["inventory sync", "multi channel", "ecommerce ops", "shipping"],
    landingPage: "https://parcelpilot.example.com/sync",
    lastSeen: "Mar 08",
    platforms: ["Instagram", "Facebook"],
    preview: {
      accent: "#0f7de7",
      badge: "Video demo",
      headline: "Every channel says something different.",
      subhead: "Your ops stack should not.",
    },
    researchNote:
      "Clear operations angle. The line between backend reliability and brand promise is the hook.",
    status: "active",
  },
  {
    id: "fieldnote-retargeting",
    advertiser: "FieldNote CRM",
    angleTags: ["Retargeting", "Pipeline follow-up", "Sales"],
    copy:
      "A CRM ad that sells speed of follow-up by showing how fast leads go cold after the form fill.",
    countries: ["United States", "Canada", "Australia"],
    creativeType: "image",
    cta: "Get started",
    firstSeen: "Jan 29",
    hook: "Leads do not wait for your next clean-up sprint.",
    keywords: ["lead follow-up", "crm", "retargeting", "sales pipeline"],
    landingPage: "https://fieldnote.example.com/retargeting",
    lastSeen: "Mar 07",
    platforms: ["Facebook", "Instagram"],
    preview: {
      accent: "#8757d8",
      badge: "Static image",
      headline: "The form fill is not the win.",
      subhead: "Follow-up speed is.",
    },
    researchNote:
      "Good bridge between CRM category language and paid social urgency framing.",
    status: "active",
  },
  {
    id: "northline-analytics",
    advertiser: "Northline Analytics",
    angleTags: ["Attribution", "Ops visibility", "B2B"],
    copy:
      "Analytics software positioned as a cleaner way to map spend against real pipeline movement.",
    countries: ["United States", "United Kingdom"],
    creativeType: "carousel",
    cta: "Watch demo",
    firstSeen: "Dec 16",
    hook: "If attribution is a fight every Monday, the setup is the problem.",
    keywords: ["attribution", "pipeline reporting", "analytics", "watch demo"],
    landingPage: "https://northline.example.com/attribution",
    lastSeen: "Mar 05",
    platforms: ["Facebook"],
    preview: {
      accent: "#0c8f6a",
      badge: "Carousel",
      headline: "Attribution that survives the QBR.",
      subhead: "Make paid spend easier to defend in front of finance.",
    },
    researchNote:
      "The ad is selling internal clarity and stakeholder confidence more than analytics features.",
    status: "paused",
  },
  {
    id: "ablebook-no-show",
    advertiser: "Ablebook",
    angleTags: ["Appointments", "No-shows", "Reminder flow"],
    copy:
      "Booking software framed around fewer no-shows and less client friction before the appointment.",
    countries: ["United States", "United Kingdom", "Canada"],
    creativeType: "video",
    cta: "Try the scheduler",
    firstSeen: "Feb 21",
    hook: "A reminder flow matters more than another calendar integration.",
    keywords: ["no-show", "scheduler", "booking", "reminder flow"],
    landingPage: "https://ablebook.example.com/reminders",
    lastSeen: "Mar 11",
    platforms: ["Instagram", "Facebook"],
    preview: {
      accent: "#d28c3c",
      badge: "Video creative",
      headline: "No-shows start before the appointment.",
      subhead: "Fix the reminder sequence, not just the booking form.",
    },
    researchNote:
      "Useful example of an ad selling process correction rather than simple feature breadth.",
    status: "active",
  },
];
