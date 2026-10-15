import { OPERATOR, type LegalDocument } from "./document";

const SECURITY_UPDATED = "2026-10-12";

export const SECURITY: LegalDocument = {
  path: "/security",
  title: "Security",
  updated: SECURITY_UPDATED,
  walled: true,
  description:
    "How Five to Nine keeps your workspace safe: where the data lives, how you sign in, what agents can touch, and how to report a security problem.",
  intro: `This page says, in plain words, how ${OPERATOR} protects what you give it and how to tell us if you find a hole. What we collect and for how long is on the privacy page.`,
  sections: [
    {
      id: "short-version",
      heading: "The short version",
      list: [
        "The app and its data run on Cloudflare, and every connection is encrypted.",
        "There are no passwords to steal: you sign in with a one-time email link or a passkey.",
        "Your agents and API keys can read your workspace and cannot change it.",
        "We watch brands and creators in public. We never read anything behind a login.",
        "Found a problem? Email us. A person reads every report.",
      ],
    },
    {
      id: "where-data-lives",
      heading: "Where your data lives",
      paragraphs: [
        "0509 runs on Cloudflare: the app, the database, the stored screenshots and the AI models that read public pages all sit there. The privacy page lists every company that handles a part of it, and what each one sees.",
        "Your card details go to Dodo Payments and never reach us.",
      ],
    },
    {
      id: "signing-in",
      heading: "Signing in",
      list: [
        "Sign-in links work once and expire after five minutes.",
        "Passkeys keep your fingerprint or face on your device. We store only the public half.",
        "A sign-in check keeps bots out of the login form.",
        "Sessions end when you sign out, or after seven days without use.",
      ],
    },
    {
      id: "agents",
      heading: "Agents and API keys",
      paragraphs: [
        "Your own AI agents and tools reach 0509 by an app you approve or a key you create. They see only your workspace, and they cannot change anything in it.",
        "We keep only a scrambled copy of each key and show it to you once. Settings lists every connected app and key, and you can disconnect any of them at any time.",
      ],
    },
    {
      id: "in-the-browser",
      heading: "In your browser",
      list: [
        "Every page is served over HTTPS, and browsers are told to insist on it.",
        "A strict content policy blocks scripts from sites we have not approved.",
        "No other site can put 0509 inside a frame.",
        "We use no advertising or tracking cookies.",
      ],
    },
    {
      id: "what-we-collect",
      heading: "What we collect, and what we never do",
      paragraphs: [
        "We read public pages, public posts and public feeds, and we track brands and creators, never private people. We never read direct messages, private groups or anything that needs a login.",
        "Error reports have personal details removed, and logs hold the addresses of pages requested, never account content.",
      ],
      link: { href: "/privacy", label: "Read the privacy policy" },
    },
    {
      id: "report-a-problem",
      heading: "Report a security problem",
      paragraphs: [
        "If you think you found a weakness, email the address under Contact with what you saw and how to repeat it. Please do not read or change anyone else's data, and give us a chance to fix it before you share it.",
        "Our security contact is also published as a machine-readable file for researchers' tools.",
      ],
      link: { href: "/.well-known/security.txt", label: "Open security.txt" },
    },
  ],
};
