export type JsonRecord = Record<string, unknown>;

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

export interface ParamView {
  name: string;
  where: string;
  required: boolean;
  type: string;
  description: string;
}

export interface ResponseView {
  status: string;
  description: string;
  shape: string;
}

export interface EndpointView {
  path: string;
  method: string;
  summary: string;
  parameters: ParamView[];
  responses: ResponseView[];
}

export interface FieldView {
  name: string;
  type: string;
  description: string;
}

export interface SchemaView {
  name: string;
  fields: FieldView[];
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function refName(ref: string): string {
  const name = ref.split("/").at(-1);
  if (name === undefined || name === "") {
    throw new Error(`OpenAPI $ref has no name: ${ref}`);
  }
  return decodeURIComponent(name);
}

function schemaRef(schema: unknown): string | null {
  if (!isRecord(schema) || typeof schema.$ref !== "string") return null;
  return schema.$ref;
}

export function schemaLabel(schema: unknown): string {
  const ref = schemaRef(schema);
  if (ref !== null) return refName(ref);
  if (!isRecord(schema)) return "value";
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(schemaLabel).join(" or ");
  if (schema.type === "array") return `${schemaLabel(schema.items)} list`;
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(", ");
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) return schema.type.map(String).join(" or ");
  return "object";
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function paramView(parameter: unknown): ParamView {
  if (!isRecord(parameter) || typeof parameter.name !== "string") {
    throw new Error("OpenAPI parameter is missing a name");
  }
  const where = typeof parameter.in === "string" ? parameter.in : "query";
  return {
    name: parameter.name,
    where,
    required: parameter.required === true || where === "path",
    type: schemaLabel(parameter.schema),
    description: typeof parameter.description === "string" ? parameter.description : "",
  };
}

function jsonSchema(response: JsonRecord): unknown {
  if (!isRecord(response.content)) return null;
  const json = response.content["application/json"];
  return isRecord(json) ? json.schema : null;
}

function responseShape(schema: unknown, fields: FieldView[]): string {
  if (schema == null) return "";
  if (fields.length > 0) return fields.map((field) => `${field.name}: ${field.type}`).join(", ");
  return schemaLabel(schema);
}

function responseView(status: string, response: unknown): ResponseView {
  if (!isRecord(response) || typeof response.description !== "string") {
    throw new Error(`OpenAPI response ${status} is missing a description`);
  }
  const schema = jsonSchema(response);
  const fields = schemaFields(schema);
  return {
    status,
    description: response.description,
    shape: responseShape(schema, fields),
  };
}

function operations(item: JsonRecord): { method: string; operation: JsonRecord }[] {
  return METHODS.filter((method) => isRecord(item[method])).map((method) => ({
    method,
    operation: item[method],
  }));
}

function endpointFrom(path: string, item: JsonRecord): EndpointView[] {
  const ops = operations(item);
  if (ops.length === 0) {
    throw new Error(`OpenAPI path ${path} has no operation`);
  }
  const shared = asList(item.parameters).map(paramView);
  return ops.map(({ method, operation }) => ({
    path,
    method,
    summary: typeof operation.summary === "string" ? operation.summary : path,
    parameters: [...shared, ...asList(operation.parameters).map(paramView)],
    responses: Object.entries(isRecord(operation.responses) ? operation.responses : {}).map(([status, response]) =>
      responseView(status, response),
    ),
  }));
}

export function endpointViews(document: JsonRecord): EndpointView[] {
  if (!isRecord(document.paths)) {
    throw new Error("OpenAPI document has no paths");
  }
  return Object.entries(document.paths).flatMap(([path, item]) => {
    if (!isRecord(item)) {
      throw new Error(`OpenAPI path ${path} is not an object`);
    }
    return endpointFrom(path, item);
  });
}

function fieldView(name: string, schema: unknown): FieldView {
  const description = isRecord(schema) && typeof schema.description === "string" ? schema.description : "";
  return { name, type: schemaLabel(schema), description };
}

export function schemaFields(schema: unknown): FieldView[] {
  const ref = schemaRef(schema);
  if (ref !== null) return [{ name: refName(ref), type: refName(ref), description: "" }];
  if (!isRecord(schema) || !isRecord(schema.properties)) return [];
  return Object.entries(schema.properties).map(([name, property]) => fieldView(name, property));
}

export function schemaViews(document: JsonRecord): SchemaView[] {
  const components = isRecord(document.components) ? document.components : {};
  const schemas = isRecord(components.schemas) ? components.schemas : {};
  return Object.entries(schemas).map(([name, schema]) => ({
    name,
    fields: schemaFields(schema),
  }));
}

export function bearerCopy(document: JsonRecord): string {
  const components = isRecord(document.components) ? document.components : {};
  const schemes = isRecord(components.securitySchemes) ? components.securitySchemes : {};
  const apiKey = schemes.apiKey;
  if (!isRecord(apiKey) || apiKey.scheme !== "bearer") {
    throw new Error("OpenAPI document is missing the bearer security scheme");
  }
  const description = typeof apiKey.description === "string" ? apiKey.description : "";
  return description;
}
