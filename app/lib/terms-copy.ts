export interface Plan {
  name: string;
  price: string;
  cadence: string;
}

export const SUPPORT_ADDRESS = "support@0509.io";

export const PLANS: Plan[] = [
  { name: "Scout", price: "EUR 10", cadence: "5 competitors tracked at once, daily cadence" },
  { name: "Starter", price: "EUR 46", cadence: "15 competitors at once, checks every 6 hours" },
  {
    name: "Agency",
    price: "EUR 136",
    cadence: "50 competitors per workspace, checks every 6 hours",
  },
];

export interface Section {
  heading: string;
  paragraphs: string[];
}

export const SECTIONS: Section[] = [
  {
    heading: "Plans and prices",
    paragraphs: [
      "There is no free plan. Every paid plan starts with a 7-day trial. Prices are per workspace, billed monthly, in euros.",
      "Prices can change. A change is announced before it applies to your next charge, and it never changes a charge already billed.",
    ],
  },
  {
    heading: "The trial",
    paragraphs: [
      "Every paid plan includes a 7-day trial. We take your card when you start the trial. On day 8 the trial ends and the first monthly charge is taken, unless you cancel before then.",
      "Cancel during the trial and you are not charged. Nothing has to be returned, because there is nothing to return: you keep what you have already seen and the workspace closes.",
    ],
  },
  {
    heading: "Billing",
    paragraphs: [
      "Billing goes through Dodo Payments, which takes the card and sends the receipt. We never see or store your card number. Your charge appears as a Dodo Payments charge on your statement.",
    ],
  },
  {
    heading: "Cancelling",
    paragraphs: [
      "Cancel any time from workspace settings. Cancelling stops the next charge and the subscription does not renew. The workspace stays open and readable until the end of the period you have already paid for.",
      "During the trial, cancel before day 8 and no charge is taken.",
    ],
  },
  {
    heading: "Refunds",
    paragraphs: [
      "There is no automatic refund. If you were charged for something that was not what you agreed to, email us and a person reads it. Say what happened and when, and we will put it right or explain why not.",
    ],
  },
  {
    heading: "Deleting your workspace",
    paragraphs: [
      "Deleting a workspace deletes every row you own and every stored file under its prefix, in one run, and stops every email. This is permanent: once it is done, there is nothing left to restore. If you are not certain, cancel first and take the rest of the period to look.",
    ],
  },
  {
    heading: "What this service is",
    paragraphs: [
      "0509 reads public pages, public posts, public ad libraries and public feeds, and screenshots public pages. That is the whole source of data.",
      "What it does not do: read anything behind a login, hold anyone's private messages, or buy personal data. It tracks brands, companies, products and creators who publish under a public handle or domain, never a private individual.",
      "Public data is not complete and nobody can make it complete. A source can be unreachable, rate-limited or partly broken, and a source that is not behaving is marked as degraded in the product and shown to you as degraded. What we do not do is fill the gap with a guess, so a missing number can mean the source, not the brand.",
    ],
  },
];
