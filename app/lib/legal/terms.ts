import {
  GOVERNING_LAW,
  LIABILITY_CAP_MONTHS,
  MINIMUM_AGE,
  OPERATOR,
  PRICE_NOTICE_DAYS,
  type LegalDocument,
} from "./document";

export const TERMS: LegalDocument = {
  path: "/terms",
  title: "Terms of service",
  description:
    "The agreement for using Five to Nine: who can use it, fair use, agent access, plans and cancelling, what belongs to whom, limits, and how either side can end it.",
  intro: `These terms are the agreement between you and ${OPERATOR} when you use 0509. They are in plain words on purpose. If anything here is unclear, ask us before you rely on it.`,
  sections: [
    {
      id: "short-version",
      heading: "The short version",
      list: [
        "0509 is for businesses. You use it to watch brands and creators, never private people.",
        "What we show comes from public sources. It can be late, incomplete or wrong, so check before you act on it.",
        "Your data stays yours. We use it only to run 0509 for you.",
        "You can cancel any time, and you keep access until the end of the period you paid for.",
      ],
    },
    {
      id: "who-can-use",
      heading: "Who can use 0509",
      paragraphs: [
        `You must be at least ${String(MINIMUM_AGE)} and use 0509 for a business, a brand, or your work as a creator. If you sign up for a company, you confirm you can agree to these terms for it.`,
        "Keep your sign-in to yourself. You are responsible for what happens in your account, including what your agents do with the keys you give them.",
      ],
    },
    {
      id: "what-it-does",
      heading: "What 0509 does",
      paragraphs: [
        "0509 reads public pages, public posts, public ad libraries and public feeds, takes screenshots of public pages, and tells you what changed and where you stand. It never reads anything behind a login.",
        "Public data is never complete. A source can be down, slow or changed. When a source is not working, 0509 marks it as degraded rather than guessing.",
        "Rankings and summaries are our judgment, made partly by AI. They are not legal, financial or professional advice.",
      ],
    },
    {
      id: "fair-use",
      heading: "Fair use",
      paragraphs: ["You agree not to:"],
      list: [
        "track a private individual, a child, or anyone who has asked to be removed",
        "use 0509 to harass, stalk or intimidate anyone",
        "get around limits, reach another customer's data, or test or break our security without our written permission",
        "copy 0509 itself, or resell what it collects as your own data product",
        "use 0509 for anything illegal",
      ],
      closing: [
        "If you do, we may pause or close your account. Where we can, we tell you first and give you a chance to put it right.",
      ],
    },
    {
      id: "agents",
      heading: "Agents and API access",
      paragraphs: [
        "You can connect your own AI agents and tools by approving them when they ask, or with keys you create in 0509. Either way they can read your workspace and cannot change it.",
        "Keep keys secret, and disconnect any app or key you think has leaked. Agents follow these same terms and the same fair limits, and we may switch off a key that is overloading 0509 or breaking these terms.",
      ],
    },
    {
      id: "sharing",
      heading: "Sharing",
      paragraphs: [
        "0509 publishes no pages about you. If you share a picture of your standing, you choose where it goes. Please do not edit it to say something 0509 did not.",
      ],
    },
    {
      id: "plans",
      heading: "Plans and payment",
      paragraphs: [
        "0509 is a paid subscription. The price, what the plan includes, and any trial are shown before you pay. You pay in advance for each period through our payment provider, which adds tax where the law requires. Plans renew until you cancel.",
        "Cancel any time. Cancelling stops the next payment, and you keep access until the end of the period you already paid for. We do not refund part-used periods, except where the law requires it or we made a mistake.",
        `If we change a price, we tell you at least ${String(PRICE_NOTICE_DAYS)} days before it applies to you, and you can cancel before then.`,
      ],
    },
    {
      id: "your-data",
      heading: "Your data",
      paragraphs: [
        "Your workspace and everything you put in it stay yours. You let us use it only to run 0509 for you.",
      ],
      link: { href: "/privacy", label: "Read what we collect and how long we keep it" },
    },
    {
      id: "ownership",
      heading: "What belongs to whom",
      paragraphs: [
        "0509's software, design and name belong to us. The briefs, screenshots and rankings we make for you are yours to use in your business.",
        "Screenshots show other brands' content, which stays theirs. Share it only as the law allows, for example to comment on it or compare against it.",
      ],
    },
    {
      id: "removal",
      heading: "Removal requests",
      paragraphs: [
        "Any brand or creator can ask us to stop tracking them. When they do, we stop for every customer and tell you in Alerts. It does not change your price.",
      ],
    },
    {
      id: "availability",
      heading: "Keeping 0509 running",
      paragraphs: [
        "We work to keep 0509 fast and available, but we cannot promise it will never be down or never make a mistake.",
        "We may improve, change or retire features. If we remove something central to your plan, we tell you first, and you can cancel.",
      ],
    },
    {
      id: "liability",
      heading: "Limits on our responsibility",
      paragraphs: [
        "0509 is provided as it is. As far as the law allows, we are not responsible for indirect losses, such as lost profit or business, or for decisions you make from what 0509 shows.",
        `Our total responsibility to you for any claim is capped at what you paid us in the ${String(LIABILITY_CAP_MONTHS)} months before it. Nothing here limits a responsibility the law does not let us limit, such as for fraud.`,
      ],
    },
    {
      id: "ending",
      heading: "Ending the agreement",
      paragraphs: [
        "You can stop using 0509 and close your account at any time.",
        "We can end it if you break these terms, or with 30 days' notice for any other reason, in which case we refund what you paid for time you will not get.",
        "When your account closes, we delete your data as the privacy policy says.",
      ],
    },
    {
      id: "changes",
      heading: "Changes to these terms",
      paragraphs: [
        "When we change these terms, we update this page and its date. If a change affects you, we email you at least 30 days before it applies. If you keep using 0509 after that, the new terms apply.",
      ],
    },
    {
      id: "law",
      heading: "Law and disputes",
      paragraphs: [
        `These terms are governed by the laws of ${GOVERNING_LAW}. If we disagree, write to us first and we will try to sort it out together.`,
        `If we cannot, the courts of ${GOVERNING_LAW} decide, unless the law where you live gives you the right to use your own courts.`,
      ],
    },
  ],
};
