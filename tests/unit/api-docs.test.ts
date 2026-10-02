import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiReference } from "../../app/components/api-reference";
import { schemaFields, schemaLabel, type JsonRecord } from "../../app/lib/agent/api-docs";
import { openApiDocument } from "../../app/lib/agent/openapi";
import { MCP_PATH } from "../../app/lib/agent/paths";
import { headers } from "../../app/routes/api-docs";

const ORIGIN = "https://0509.io";
const SETTINGS = "/app/settings/agents";

function page(document: JsonRecord = openApiDocument(ORIGIN)): string {
  return renderToStaticMarkup(
    createElement(ApiReference, {
      document,
      mcpUrl: `${ORIGIN}${MCP_PATH}`,
      settingsHref: SETTINGS,
    }),
  ).replaceAll("&#x27;", "'");
}

function cloneDocument(): JsonRecord {
  return JSON.parse(JSON.stringify(openApiDocument(ORIGIN))) as JsonRecord;
}

describe("the API reference page", () => {
  it("renders every path key of the OpenAPI document", () => {
    const document = openApiDocument(ORIGIN);
    const html = page();
    const paths = Object.keys(document.paths ?? {});
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(html, path).toContain(path);
    }
  });

  it("shows bearer auth, the MCP URL, Settings for the key, and both rate limits", () => {
    const html = page();
    expect(html).toContain("Authorization: Bearer");
    expect(html).toContain(`${ORIGIN}${MCP_PATH}`);
    expect(html).toContain(`href="${SETTINGS}"`);
    expect(html).toContain("per colo");
    expect(html).toContain("eventually consistent");
    expect(html).toContain("120");
  });

  it("shows each path's parameters, response descriptions, and referenced fields", () => {
    const document = openApiDocument(ORIGIN);
    const html = page();
    const competitor = document.paths?.["/api/v1/competitors/{competitorId}"]?.get;
    expect(html).toContain("competitorId");
    expect(html).toContain("path, required");
    expect(html).toContain("brief: Brief or null");
    expect(html).toContain("periodStart");
    expect(html).toContain("ISO 8601 timestamp");
    for (const response of Object.values(competitor?.responses ?? {})) {
      if (response && typeof response === "object" && "description" in response) {
        expect(html).toContain(String(response.description));
      }
    }
  });

  it("labels a whole-schema $ref as the schema name instead of inventing a field", () => {
    const ref = { $ref: "#/components/schemas/Brief" };
    expect(schemaFields(ref)).toEqual([]);
    expect(schemaLabel(ref)).toBe("Brief");
  });

  it("is sentence case and has no exclamation marks", () => {
    const html = page();
    expect(html).toContain(">API reference<");
    expect(html).not.toContain("!");
  });

  it("still renders the other paths when one path item has no operation", () => {
    const document = cloneDocument();
    const paths = document.paths;
    if (!paths || typeof paths !== "object") throw new Error("expected paths");
    (paths as JsonRecord)["/api/v1/ghost"] = { $ref: "#/paths/unused" };
    const html = page(document);
    expect(html).toContain("/api/v1/brief");
    expect(html).not.toContain("/api/v1/ghost");
  });

  it("still renders when a response has no description", () => {
    const document = cloneDocument();
    const paths = document.paths;
    if (!paths || typeof paths !== "object") throw new Error("expected paths");
    const brief = (paths as JsonRecord)["/api/v1/brief"];
    if (!brief || typeof brief !== "object") throw new Error("expected brief");
    const get = (brief as JsonRecord).get;
    if (!get || typeof get !== "object") throw new Error("expected get");
    const responses = (get as JsonRecord).responses;
    if (!responses || typeof responses !== "object") throw new Error("expected responses");
    (responses as JsonRecord)["599"] = {};
    expect(page(document)).toContain("/api/v1/brief");
  });

  it("still renders bearer instructions when the security scheme is missing", () => {
    const document = cloneDocument();
    delete document.components;
    const html = page(document);
    expect(html).toContain("Authorization: Bearer");
    expect(html).toContain("/api/v1/brief");
  });

  it("gives each method its own heading id when a path has two operations", () => {
    const html = page({
      paths: {
        "/api/v1/brief": {
          get: { summary: "read", responses: { "200": { description: "ok" } } },
          post: { summary: "write", responses: { "200": { description: "created" } } },
        },
      },
      components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "An API key from Settings" } } },
    });
    expect(html).toContain('id="get-api-v1-brief"');
    expect(html).toContain('id="post-api-v1-brief"');
  });

  it("does not cache a request-time origin", () => {
    expect(headers()).toEqual({ "cache-control": "no-store" });
  });
});
