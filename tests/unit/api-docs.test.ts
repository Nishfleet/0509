import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiReference } from "../../app/components/api-reference";
import { schemaFields, schemaLabel, type JsonRecord } from "../../app/lib/agent/api-docs";
import { openApiDocument } from "../../app/lib/agent/openapi";
import { MCP_PATH } from "../../app/lib/agent/paths";
import { PROBLEMS } from "../../app/lib/agent/problems";

const ORIGIN = "https://0509.io";
const SETTINGS = "/app/settings/agents";

function page(): string {
  return renderToStaticMarkup(
    createElement(ApiReference, {
      document: openApiDocument(ORIGIN) as unknown as JsonRecord,
      exampleUrl: `${ORIGIN}/api/v1/brief`,
      mcpUrl: `${ORIGIN}${MCP_PATH}`,
      settingsHref: SETTINGS,
    }),
  ).replaceAll("&#x27;", "'");
}

describe("the API reference page", () => {
  it("shows a copy-paste curl line with the bearer header", () => {
    expect(page()).toContain(`curl -H &quot;Authorization: Bearer &lt;key&gt;&quot; ${ORIGIN}/api/v1/brief`);
  });

  it("shows a Claude Code line that adds the MCP server by its address", () => {
    expect(page()).toContain(`claude mcp add --transport http five-to-nine ${ORIGIN}${MCP_PATH}`);
  });

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
    expect(html).toContain("120 requests a minute");
    expect(html).toContain("Retry-After");
  });

  it("lists every error code the API can return with its status and sentence", () => {
    const html = page();
    for (const [code, problem] of Object.entries(PROBLEMS)) {
      expect(html, code).toContain(code);
      expect(html, code).toContain(problem.description.replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
    }
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
});
