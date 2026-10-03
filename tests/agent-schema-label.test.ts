import { describe, expect, it } from "vitest";

import { schemaFields, schemaLabel } from "../app/lib/agent/api-docs";

describe("the label an OpenAPI schema gets", () => {
  it("calls anything that is not a schema object a value", () => {
    expect(schemaLabel(undefined)).toBe("value");
    expect(schemaLabel("x")).toBe("value");
    expect(schemaLabel([])).toBe("value");
  });

  it("joins an enum's members with commas", () => {
    expect(schemaLabel({ enum: ["a", "b", 3] })).toBe("a, b, 3");
  });

  it("names the item type of an array", () => {
    expect(schemaLabel({ type: "array", items: { type: "string" } })).toBe("string list");
  });

  it("follows a $ref inside an array to the schema name", () => {
    expect(schemaLabel({ type: "array", items: { $ref: "#/components/schemas/Alert" } })).toBe("Alert list");
  });

  it("calls a raw list of items one unknown value, so it reads as an unnamed list", () => {
    expect(schemaLabel({ type: "array", items: [{ $ref: "#/components/schemas/Alert" }] })).toBe("value list");
  });

  it("reads a union of schemas as or", () => {
    expect(schemaLabel({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("string or null");
  });

  it("reads a list of type names as or", () => {
    expect(schemaLabel({ type: ["string", "null"] })).toBe("string or null");
  });

  it("falls back to object when the schema names no type", () => {
    expect(schemaLabel({})).toBe("object");
    expect(schemaLabel({ properties: {} })).toBe("object");
  });

  it("decodes a percent-encoded $ref name", () => {
    expect(schemaLabel({ $ref: "#/components/schemas/My%20Thing" })).toBe("My Thing");
  });

  it("refuses a $ref that names no schema", () => {
    expect(() => schemaLabel({ $ref: "#/components/schemas/" })).toThrow(/has no name/);
  });
});

describe("the fields an OpenAPI schema lists", () => {
  it("reads each property's name, type and description", () => {
    expect(schemaFields({ properties: { n: { type: "integer", description: "count" } } })).toEqual([
      { name: "n", type: "integer", description: "count" },
    ]);
  });

  it("leaves the description blank when the property has none", () => {
    expect(schemaFields({ properties: { n: { type: "integer" } } })).toEqual([
      { name: "n", type: "integer", description: "" },
    ]);
  });

  it("lists no fields for a schema that has no properties", () => {
    expect(schemaFields({ type: "object" })).toEqual([]);
  });
});
