import { env } from "cloudflare:workers";
import { getDomain } from "tldts";
import { z } from "zod";

import { GATEWAY_ID } from "../../jev/client.server";
import {
  defaultFetchText,
  type Candidate,
  type FetchText,
  type Generator,
  type Subject,
} from "../types";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const MAX_PROPOSALS = 10;

const DOMAIN_TIMEOUT_MS = 5_000;

const SNIPPET_LIMIT = 300;

const EXCERPT = "Proposed by a language model reading the brand's own site; not corroborated by any other source";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    competitors: {
      type: "array",
      maxItems: MAX_PROPOSALS,
      items: {
        type: "object",
        properties: { name: { type: "string" }, domain: { type: "string" } },
        required: ["name", "domain"],
      },
    },
  },
  required: ["competitors"],
} as const;

const proposalSchema = z.object({
  competitors: z.array(z.object({ name: z.string(), domain: z.string() })),
});

const answerSchema = z.object({ response: z.unknown() });

interface SiteText {
  title: string;
  description: string;
}

async function readSiteText(html: string): Promise<SiteText> {
  const found: SiteText = { title: "", description: "" };
  const rewritten = new HTMLRewriter()
    .on("title", {
      text(chunk) {
        found.title += chunk.text;
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        if (found.description === "") found.description = el.getAttribute("content") ?? "";
      },
    })
    .transform(new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } }));
  await rewritten.arrayBuffer();
  return { title: found.title.trim().slice(0, SNIPPET_LIMIT), description: found.description.trim().slice(0, SNIPPET_LIMIT) };
}

async function siteTextOf(subject: Subject, fetchText: FetchText): Promise<SiteText> {
  const page = await fetchText(`https://${subject.domain}/`);
  if (!page.ok) return { title: "", description: "" };
  return readSiteText(page.body);
}

function messagesFor(subject: Subject, site: SiteText): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content: `Name up to ${String(MAX_PROPOSALS)} real, currently operating competitor brands of the company described by the user. Give each one's primary website domain. Only include brands you are confident exist; never invent a domain.`,
    },
    {
      role: "user",
      content: JSON.stringify({
        name: subject.name,
        domain: subject.domain,
        description: subject.description ?? null,
        homepage_title: site.title,
        homepage_description: site.description,
      }),
    },
  ];
}

function jsonOf(response: unknown): unknown {
  if (typeof response !== "string") return response;
  try {
    return JSON.parse(response);
  } catch (error) {
    console.error(JSON.stringify({ event: "discovery.ai_unparseable", error: String(error) }));
    return null;
  }
}

async function propose(subject: Subject, site: SiteText): Promise<{ name: string; domain: string }[]> {
  const raw: unknown = await env.AI.run(
    MODEL,
    {
      messages: messagesFor(subject, site),
      response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
    },
    { gateway: { id: GATEWAY_ID } },
  );
  const answer = answerSchema.safeParse(raw);
  const parsed = proposalSchema.safeParse(answer.success ? jsonOf(answer.data.response) : null);
  if (!parsed.success) throw new Error("ai proposer returned malformed JSON");
  return parsed.data.competitors.slice(0, MAX_PROPOSALS);
}

async function isLive(domain: string): Promise<boolean> {
  try {
    await fetch(`https://${domain}/`, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(DOMAIN_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

async function liveCandidates(subject: Subject, proposals: readonly { name: string; domain: string }[]): Promise<Candidate[]> {
  const own = getDomain(subject.domain);
  const seen = new Set<string>();
  const named = proposals.flatMap((proposal) => {
    const domain = getDomain(proposal.domain);
    const name = proposal.name.trim();
    if (domain === null || name === "" || domain === own || seen.has(domain)) return [];
    seen.add(domain);
    return [{ name, domain }];
  });
  const live = await Promise.all(named.map((item) => isLive(item.domain)));
  return named.filter((_, index) => live[index]).map((item) => ({
    name: item.name,
    domain: item.domain,
    evidence: [{ sourceUrl: `https://${subject.domain}/`, excerpt: EXCERPT, generator: "ai" }],
  }));
}

export const aiGenerator: Generator = async (subject: Subject, fetchText?: FetchText) => {
  try {
    const site = await siteTextOf(subject, fetchText ?? defaultFetchText("discovery.ai_fetch_failed"));
    return await liveCandidates(subject, await propose(subject, site));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "discovery.ai_proposer_failed",
        message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      }),
    );
    return [];
  }
};
