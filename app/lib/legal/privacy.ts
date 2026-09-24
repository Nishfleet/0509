import {
  ACCOUNT_DELETION_DAYS,
  MINIMUM_AGE,
  OPERATOR,
  type LegalDocument,
} from "./document";

export const PRIVACY: LegalDocument = {
  path: "/privacy",
  title: "Privacy policy",
  description:
    "What Five to Nine collects about customers and about the brands it tracks, who helps run it, how long it keeps each thing, and how to have it deleted or be removed.",
  intro:
    "This page says what we collect, why, who helps us run 0509, how long we keep it, and how to have it deleted. It covers two groups: our customers, and the brands and creators we track.",
  sections: [
    {
      id: "short-version",
      heading: "The short version",
      list: [
        "We track brands and creators from what they publish in public. Never private individuals.",
        "We collect as little about you as we can: your email, your sign-in, and the brands you ask us to watch.",
        "We never sell your data and never show you ads.",
        "Nothing about your workspace sits on a public page. Sharing is a picture you choose to post.",
        "You can ask for a copy of your data, or for it to be deleted, at any time.",
        "Any brand or creator can ask to be removed from tracking, and we act within 72 hours.",
      ],
    },
    {
      id: "who-we-are",
      heading: "Who we are",
      paragraphs: [
        `${OPERATOR} runs 0509.io. For your account data we are the controller: we decide how it is used, and we answer for it.`,
        "Every question about privacy goes to the address under Contact at the end of this page. A person reads each one.",
      ],
    },
    {
      id: "about-you",
      heading: "What we collect about you",
      list: [
        "Your account: your email address, and a name if you give one.",
        "Your sign-in: the public half of a passkey, if you set one up. Your fingerprint or face never leaves your device, and we store no passwords.",
        "Your sessions: when you signed in, and the IP address and browser you used, so you stay signed in and we can spot someone else using your account.",
        "Your workspace: your brand, the competitors you watch, your settings and time zone, and the choices you make, such as dismissing a suggestion or turning a brand off.",
        "Your agent access: the apps you approved, and a scrambled copy of each key you create, with when it was last used.",
        "Billing: your plan and whether it is paid. Your card details go to our payment provider and never reach us.",
        "Emails you send us, so we can answer them.",
        "Page views, counted without cookies and without identifying you, and error reports with personal details removed, so we can keep 0509 fast and working.",
      ],
    },
    {
      id: "about-brands",
      heading: "What we collect about the brands we track",
      paragraphs: [
        "We track brands, companies, products, and creators who publish under a public handle or domain. The subject has to present itself to the public for commercial or audience reasons.",
        "We never track a private individual. We never track minors, accounts marked private, or anything behind a login.",
        "We collect public pages, public posts, public ad libraries, public feeds, and screenshots of public pages. We do not collect direct messages, private groups, or purchased personal data.",
        "A mention keeps the headline, the URL, the source, the date, and the excerpt needed to show the change. We never keep the full text of a third-party post.",
      ],
    },
    {
      id: "how-we-use-it",
      heading: "How we use it",
      list: [
        "To run 0509: find your competitors, check what they change, and rank you against them.",
        "To send you the weekly brief, and an alert when your own site looks broken.",
        "To keep your account secure and stop abuse.",
        "To answer you when you write to us.",
      ],
      closing: [
        "We never sell your data, never use it for advertising, and never share it with a brand you track.",
        "Where the GDPR applies, our legal reasons are to deliver the service you signed up for, and our legitimate interest in keeping it secure and in reading what brands publish in public.",
      ],
    },
    {
      id: "who-helps",
      heading: "Who helps us run 0509",
      paragraphs: [
        "A few companies do part of the work for us. Each gets only what its job needs, and handles it under its own data protection terms.",
      ],
      entries: [
        {
          term: "Cloudflare",
          details: [
            "Hosting, the database, file storage, screenshots, sending email, page-view counts, and small AI tasks such as reading text off an image.",
            "Sees everything 0509 stores, because 0509 runs on it.",
          ],
        },
        {
          term: "AI model providers",
          details: [
            "Deciding which changes matter and why.",
            "See the public material we collected and the names of your brand and competitors. Never your email or payment details.",
          ],
        },
        {
          term: "Our payment provider",
          details: [
            "Taking payment, charging tax, and sending receipts, once paid plans open.",
            "Sees your billing details.",
          ],
        },
        {
          term: "Sentry",
          details: [
            "Reports when something breaks.",
            "Sees technical details of the error, with personal details removed.",
          ],
        },
        {
          term: "Google (Gmail)",
          details: ["Our support inbox.", "Sees the emails you send us."],
        },
        {
          term: "GitHub",
          details: ["Our work tracker.", "Sees a note that a report arrived, never what it says."],
        },
      ],
      closing: [
        "Some of these companies work outside your country, including in the United States. Where the GDPR applies, those transfers use the European Commission's standard contractual clauses.",
      ],
    },
    {
      id: "sharing",
      heading: "Sharing your standing",
      paragraphs: [
        "Nothing about your workspace is published at a public web address, so there is nothing for a search engine to find.",
        "When you want to show where you stand, 0509 makes a picture of your weekly standing with 0509 branding, inside your signed-in account. You choose where it goes. The picture shows your brand and your rank, not the competitors you watch.",
      ],
    },
    {
      id: "agents",
      heading: "Agents and API keys",
      paragraphs: [
        "Your own AI agents and tools can read your workspace, either by asking you to sign in and approve them, or with a key you create. Either way they read only your workspace, and cannot change anything.",
        "We keep only a scrambled copy of each key, so we show it to you once, when you create it. Settings lists every connected app and key, and you can disconnect any of them at any time.",
      ],
    },
    {
      id: "cookies",
      heading: "Cookies",
      paragraphs: [
        "We set two small cookies: one keeps you signed in, and one remembers your time zone so the brief arrives on your Monday morning.",
        "We use no advertising or tracking cookies, and our page-view counts use none, so there is no cookie banner.",
      ],
    },
    {
      id: "how-long",
      heading: "How long we keep it",
      entries: [
        {
          term: "Your account and workspace",
          details: [
            `While your account is open, and deleted within ${String(ACCOUNT_DELETION_DAYS)} days of closing it.`,
          ],
        },
        {
          term: "Sign-in links",
          details: ["Five minutes, and each works once."],
        },
        {
          term: "Sign-in sessions",
          details: ["Until you sign out, or after seven days without use."],
        },
        {
          term: "Emails you send us",
          details: ["Our own copy is deleted after 90 days. The support inbox keeps them while we help you."],
        },
        {
          term: "Screenshots and copies of public pages",
          details: [
            "One year. After that, only the before-and-after changes and summaries remain.",
          ],
        },
        {
          term: "Incident records for your own site",
          details: ["One year."],
        },
        {
          term: "Billing records",
          details: ["As long as tax law requires."],
        },
      ],
    },
    {
      id: "deletion",
      heading: "Deleting your data",
      paragraphs: [
        "Ask us by email to close your account, and we delete it. Deleting a workspace deletes every record it owns and every file it stored, in one run, and stops every email.",
        'Removing a competitor keeps its history, unless you choose "remove and forget", which deletes what we collected about that competitor for your workspace.',
      ],
    },
    {
      id: "your-rights",
      heading: "Your rights",
      paragraphs: ["Wherever you live, you can ask us to:"],
      list: [
        "show you a copy of the data we hold about you",
        "correct it",
        "delete it",
        "give it to you in a common format you can take elsewhere",
        "stop or limit a use of it you object to",
      ],
      closing: [
        "Email us and we answer within 30 days. We may ask you to confirm the request from the email address on your account.",
        "If you think we got it wrong, you can also complain to the data protection authority where you live.",
      ],
    },
    {
      id: "security",
      heading: "Keeping it safe",
      paragraphs: [
        "Every connection to 0509 is encrypted. Sign-in uses one-time email links and passkeys, so there is no password to steal. Only the people who run 0509 can reach your data.",
        "If a breach ever affects your data, we tell you and the regulator without delay.",
      ],
    },
    {
      id: "children",
      heading: "Children",
      paragraphs: [
        `0509 is for businesses. It is not meant for anyone under ${String(MINIMUM_AGE)}, and we do not knowingly collect data about children.`,
      ],
    },
    {
      id: "removal",
      heading: "Removal for brands and creators",
      paragraphs: [
        "Any brand or creator can ask to be removed from tracking by every workspace, by email to the address under Contact.",
        "We handle that within 72 hours, by hand, and keep a record of the subject, the date, and what we did.",
        "A removed subject is refused when a customer tries to add it, and dropped from existing workspaces at the next check, with a one-line note to each owner.",
      ],
    },
    {
      id: "changes",
      heading: "Changes to this policy",
      paragraphs: [
        "When we change how we use your data, we update this page and its date. Before a change that matters takes effect, we email every customer.",
      ],
    },
  ],
};
