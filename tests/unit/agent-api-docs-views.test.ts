import { describe, expect, it } from "vitest";

import { bearerCopy, endpointViews, schemaViews } from "../../app/lib/agent/api-docs";

describe("endpointViews", () => {
  it("throws when the document has no paths", () => {
    expect(() => endpointViews({})).toThrow("OpenAPI document has no paths");
  });

  it("throws when a path value is not an object or has no operation", () => {
    expect(() => endpointViews({ paths: { "/x": 1 } })).toThrow("OpenAPI path /x is not an object");
    expect(() => endpointViews({ paths: { "/x": {} } })).toThrow("OpenAPI path /x has no operation");
  });

  it("falls back to the path as the summary when the operation has none", () => {
    expect(endpointViews({ paths: { "/x": { get: {} } } })).toEqual([
      { path: "/x", method: "get", summary: "/x", parameters: [], responses: [] },
    ]);
  });

  it("merges shared and operation parameters and shapes responses", () => {
    expect(
      endpointViews({
        paths: {
          "/x": {
            parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
            get: {
              summary: "S",
              parameters: [{ name: "id", in: "path", schema: { type: "string" } }],
              responses: {
                "200": {
                  description: "ok",
                  content: {
                    "application/json": {
                      schema: {
                        properties: { a: { type: "string" }, b: { type: "number" } },
                      },
                    },
                  },
                },
                "204": { description: "empty" },
                "404": {
                  description: "missing",
                  content: { "application/json": { schema: { $ref: "#/components/schemas/Err" } } },
                },
              },
            },
          },
        },
      }),
    ).toEqual([
      {
        path: "/x",
        method: "get",
        summary: "S",
        parameters: [
          { name: "q", where: "query", required: false, type: "string", description: "" },
          { name: "id", where: "path", required: true, type: "string", description: "" },
        ],
        responses: [
          { status: "200", description: "ok", shape: "a: string, b: number" },
          { status: "204", description: "empty", shape: "" },
          { status: "404", description: "missing", shape: "Err" },
        ],
      },
    ]);
  });

  it("throws when a parameter has no name or a response has no description", () => {
    expect(() =>
      endpointViews({ paths: { "/x": { get: { parameters: [{}] } } } }),
    ).toThrow("OpenAPI parameter is missing a name");
    expect(() =>
      endpointViews({ paths: { "/x": { get: { responses: { "200": {} } } } } }),
    ).toThrow("OpenAPI response 200 is missing a description");
  });

  it("throws when a $ref has no name", () => {
    expect(() =>
      endpointViews({
        paths: { "/x": { get: { parameters: [{ name: "q", schema: { $ref: "#/" } }] } } },
      }),
    ).toThrow("OpenAPI $ref has no name: #/");
  });
});

describe("schemaViews", () => {
  it("returns no views without schemas, and skips $ref schemas", () => {
    expect(schemaViews({})).toEqual([]);
    expect(
      schemaViews({
        components: {
          schemas: {
            A: { properties: { n: { type: "string", description: "d" } } },
            B: { $ref: "#/components/schemas/A" },
          },
        },
      }),
    ).toEqual([
      { name: "A", fields: [{ name: "n", type: "string", description: "d" }] },
      { name: "B", fields: [] },
    ]);
  });

  it("labels anyOf, array, enum, and type-array fields", () => {
    expect(
      schemaViews({
        components: {
          schemas: {
            S: {
              properties: {
                any: { anyOf: [{ type: "string" }, { type: "number" }] },
                list: { type: "array", items: { type: "string" } },
                choice: { enum: ["on", "off"] },
                union: { type: ["string", "null"] },
                raw: 1,
                obj: {},
              },
            },
          },
        },
      }),
    ).toEqual([
      {
        name: "S",
        fields: [
          { name: "any", type: "string or number", description: "" },
          { name: "list", type: "string list", description: "" },
          { name: "choice", type: "on, off", description: "" },
          { name: "union", type: "string or null", description: "" },
          { name: "raw", type: "value", description: "" },
          { name: "obj", type: "object", description: "" },
        ],
      },
    ]);
  });
});

describe("bearerCopy", () => {
  it("throws without a bearer scheme, and returns the description otherwise", () => {
    expect(() => bearerCopy({})).toThrow("OpenAPI document is missing the bearer security scheme");
    expect(
      bearerCopy({ components: { securitySchemes: { apiKey: { scheme: "bearer" } } } }),
    ).toBe("");
    expect(
      bearerCopy({
        components: { securitySchemes: { apiKey: { scheme: "bearer", description: "Use a key" } } },
      }),
    ).toBe("Use a key");
  });
});
