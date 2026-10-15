interface InboxLink {
  name: string;
  href: string;
}

const INBOXES: Record<string, InboxLink> = {
  gmail: { name: "Gmail", href: "https://mail.google.com/mail/u/0/#inbox" },
  outlook: { name: "Outlook", href: "https://outlook.live.com/mail/0/inbox" },
  icloud: { name: "iCloud Mail", href: "https://www.icloud.com/mail" },
  yahoo: { name: "Yahoo Mail", href: "https://mail.yahoo.com" },
  proton: { name: "Proton Mail", href: "https://mail.proton.me/u/0/inbox" },
};

const DOMAIN_INBOX: Record<string, string> = {
  "gmail.com": "gmail",
  "googlemail.com": "gmail",
  "outlook.com": "outlook",
  "hotmail.com": "outlook",
  "live.com": "outlook",
  "msn.com": "outlook",
  "icloud.com": "icloud",
  "me.com": "icloud",
  "yahoo.com": "yahoo",
  "proton.me": "proton",
  "protonmail.com": "proton",
  "pm.me": "proton",
};

export function inboxLinkFor(email: string): InboxLink | null {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  const key = DOMAIN_INBOX[domain];
  return key === undefined ? null : (INBOXES[key] ?? null);
}
