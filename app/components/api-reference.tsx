import { Footer } from "./footer";
import { Wordmark } from "./wordmark";
import {
  bearerCopy,
  endpointViews,
  schemaViews,
  type EndpointView,
  type FieldView,
  type JsonRecord,
  type ParamView,
  type ResponseView,
  type SchemaView,
} from "../lib/agent/api-docs";

const SHELL = "mx-auto w-full max-w-[46rem] min-w-0 bg-bone px-6 py-16 text-ink sm:py-24";
const TITLE = "font-display text-[clamp(1.75rem,3.6vw,2.9rem)] leading-[1.15] font-semibold tracking-[-0.02em]";
const HEADING = "font-display text-[1.15rem] leading-[1.1] font-semibold tracking-[-0.02em]";
const BODY = "mt-4 leading-[1.65] text-ink-soft";
const MONO = "font-mono text-[0.9rem] [overflow-wrap:anywhere]";
const LINK = "text-ink underline decoration-1 underline-offset-4";
const ROW = "grid gap-1 border-b border-line py-4 sm:grid-cols-[13rem_1fr] sm:gap-6";

function SettingsLink({ href }: { href: string }) {
  return (
    <a className={LINK} href={href}>
      Settings
    </a>
  );
}

function AuthBlock({ document, settingsHref }: { document: JsonRecord; settingsHref: string }) {
  const copy = bearerCopy(document);
  return (
    <section aria-labelledby="authentication" className="mt-14 scroll-mt-6">
      <h2 className={HEADING} id="authentication">
        Authentication
      </h2>
      <p className={BODY}>
        Send a key from <SettingsLink href={settingsHref} /> as:
      </p>
      <p className={`mt-3 ${MONO}`}>{`Authorization: Bearer <key>`}</p>
      {copy === "" ? null : <p className={BODY}>{copy}.</p>}
    </section>
  );
}

function McpBlock({ mcpUrl, settingsHref }: { mcpUrl: string; settingsHref: string }) {
  return (
    <section aria-labelledby="mcp-server" className="mt-14 scroll-mt-6">
      <h2 className={HEADING} id="mcp-server">
        MCP server
      </h2>
      <p className={BODY}>
        Add this address as a connector in Claude, ChatGPT or Cursor and sign in, or send a key from{" "}
        <SettingsLink href={settingsHref} />.
      </p>
      <p className={`mt-3 ${MONO}`}>{mcpUrl}</p>
    </section>
  );
}

function LimitsBlock({ settingsHref }: { settingsHref: string }) {
  return (
    <section aria-labelledby="rate-limits" className="mt-14 scroll-mt-6">
      <h2 className={HEADING} id="rate-limits">
        Rate limits
      </h2>
      <p className={BODY}>
        The edge shield allows 120 requests a minute per user. It is per colo and eventually consistent, so a burst can
        trip in one region and not another. Each key also has its own quota, shown in{" "}
        <SettingsLink href={settingsHref} />.
      </p>
    </section>
  );
}

function ParamList({ parameters }: { parameters: ParamView[] }) {
  if (parameters.length === 0) {
    return <p className={BODY}>No parameters.</p>;
  }
  return (
    <dl className="mt-6 border-t border-line">
      {parameters.map((parameter) => (
        <div className={ROW} key={`${parameter.where}:${parameter.name}`}>
          <dt className={`${MONO} text-ink`}>
            {parameter.name}
            <span className="mt-1 block font-sans text-body-sm text-ink-soft">
              {parameter.where}
              {parameter.required ? ", required" : ""}
            </span>
          </dt>
          <dd className="min-w-0 leading-[1.6] text-ink-soft">
            <p className={MONO}>{parameter.type}</p>
            {parameter.description === "" ? null : <p className="mt-1">{parameter.description}</p>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ResponseList({ responses }: { responses: ResponseView[] }) {
  return (
    <dl className="mt-6 border-t border-line">
      {responses.map((response) => (
        <div className={ROW} key={response.status}>
          <dt className={`${MONO} text-ink`}>{response.status}</dt>
          <dd className="min-w-0 leading-[1.6] text-ink-soft">
            <p>{response.description}</p>
            {response.shape === "" ? null : <p className={`mt-1 ${MONO}`}>{response.shape}</p>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Endpoint({ endpoint }: { endpoint: EndpointView }) {
  const id = `${endpoint.method}-${endpoint.path}`.replaceAll(/[^a-z0-9]+/gi, "-").replaceAll(/^-|-$/g, "");
  return (
    <article aria-labelledby={id} className="mt-10 min-w-0 border-t border-line pt-6">
      <h3 className={MONO} id={id}>
        <span className="uppercase">{endpoint.method}</span> {endpoint.path}
      </h3>
      <p className="mt-2 leading-[1.65] text-ink-soft">{endpoint.summary}</p>
      <ParamList parameters={endpoint.parameters} />
      <ResponseList responses={endpoint.responses} />
    </article>
  );
}

function FieldList({ fields }: { fields: FieldView[] }) {
  if (fields.length === 0) return null;
  return (
    <dl className="mt-4 border-t border-line">
      {fields.map((field) => (
        <div className={ROW} key={field.name}>
          <dt className={`${MONO} text-ink`}>{field.name}</dt>
          <dd className="min-w-0 leading-[1.6] text-ink-soft">
            <p className={MONO}>{field.type}</p>
            {field.description === "" ? null : <p className="mt-1">{field.description}</p>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SchemaBlock({ schema }: { schema: SchemaView }) {
  return (
    <article className="mt-10 min-w-0 border-t border-line pt-6">
      <h3 className={MONO}>{schema.name}</h3>
      <FieldList fields={schema.fields} />
    </article>
  );
}

function Endpoints({ document }: { document: JsonRecord }) {
  return (
    <section aria-labelledby="endpoints" className="mt-14 scroll-mt-6">
      <h2 className={HEADING} id="endpoints">
        Endpoints
      </h2>
      {endpointViews(document).map((endpoint) => (
        <Endpoint endpoint={endpoint} key={`${endpoint.method}:${endpoint.path}`} />
      ))}
    </section>
  );
}

function Schemas({ document }: { document: JsonRecord }) {
  return (
    <section aria-labelledby="shapes" className="mt-14 scroll-mt-6">
      <h2 className={HEADING} id="shapes">
        Response shapes
      </h2>
      {schemaViews(document).map((schema) => (
        <SchemaBlock key={schema.name} schema={schema} />
      ))}
    </section>
  );
}

export function ApiReference({
  document,
  mcpUrl,
  settingsHref,
}: {
  document: JsonRecord;
  mcpUrl: string;
  settingsHref: string;
}) {
  return (
    <div className={SHELL}>
      <header>
        <Wordmark />
      </header>
      <main className="mt-8 min-w-0">
        <h1 className={TITLE}>API reference</h1>
        <AuthBlock document={document} settingsHref={settingsHref} />
        <McpBlock mcpUrl={mcpUrl} settingsHref={settingsHref} />
        <LimitsBlock settingsHref={settingsHref} />
        <Endpoints document={document} />
        <Schemas document={document} />
      </main>
      <Footer />
    </div>
  );
}
