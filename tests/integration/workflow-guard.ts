import { env } from "cloudflare:test";
import { afterEach, beforeEach } from "vitest";

const FINAL_STATUSES = new Set(["complete", "errored", "terminated", "gone"]);

function isWorkflow(value: unknown): value is Workflow {
  return (
    typeof value === "object" &&
    value !== null &&
    "get" in value &&
    typeof value.get === "function" &&
    "create" in value &&
    typeof value.create === "function" &&
    "createBatch" in value &&
    typeof value.createBatch === "function"
  );
}

const WORKFLOWS = Object.entries(env as unknown as Record<string, unknown>).flatMap(([binding, value]) => {
  if (!isWorkflow(value)) return [];
  const get = value.get;
  const lookup = (id: string) => Reflect.apply(get, value, [id]) as Promise<WorkflowInstance>;
  return [{ binding, workflow: value, lookup }];
});

interface Started {
  binding: string;
  lookup: (id: string) => Promise<WorkflowInstance>;
  ids: Set<string>;
}

interface Leaked extends Started {
  running: { id: string; status: string }[];
}

interface Patch {
  workflow: Workflow;
  create: PropertyDescriptor | undefined;
  createBatch: PropertyDescriptor | undefined;
}

let started: Started[] = [];
let patches: Patch[] = [];

function patch(workflow: Workflow, entry: Started): Patch {
  const create = workflow.create;
  const createBatch = workflow.createBatch;
  const previous = {
    workflow,
    create: Object.getOwnPropertyDescriptor(workflow, "create"),
    createBatch: Object.getOwnPropertyDescriptor(workflow, "createBatch"),
  };
  workflow.create = async (options) => {
    const instance = (await Reflect.apply(create, workflow, [options])) as WorkflowInstance;
    entry.ids.add(instance.id);
    return instance;
  };
  workflow.createBatch = async (batch) => {
    const instances = (await Reflect.apply(createBatch, workflow, [batch])) as WorkflowInstance[];
    for (const instance of instances) entry.ids.add(instance.id);
    return instances;
  };
  return previous;
}

function restore({ workflow, create, createBatch }: Patch): void {
  if (create === undefined) Reflect.deleteProperty(workflow, "create");
  else Object.defineProperty(workflow, "create", create);
  if (createBatch === undefined) Reflect.deleteProperty(workflow, "createBatch");
  else Object.defineProperty(workflow, "createBatch", createBatch);
}

async function statusOf(lookup: (id: string) => Promise<WorkflowInstance>, id: string): Promise<string> {
  try {
    return (await (await lookup(id)).status()).status;
  } catch (error) {
    if (error instanceof Error && error.message.includes("instance.not_found")) return "gone";
    throw error;
  }
}

async function runningOf(entry: Started): Promise<Leaked> {
  const ids = [...entry.ids];
  const settled = await Promise.allSettled(ids.map((id) => statusOf(entry.lookup, id)));
  const running = settled.flatMap((result, index) => {
    if (result.status === "rejected") return [{ id: ids[index], status: "unknown" }];
    return FINAL_STATUSES.has(result.value) ? [] : [{ id: ids[index], status: result.value }];
  });
  return { ...entry, running };
}

async function terminate(leaked: Leaked[]): Promise<void> {
  await Promise.allSettled(
    leaked.flatMap(({ lookup, running }) =>
      running.map(({ id }) => lookup(id).then((instance) => instance.terminate())),
    ),
  );
}

export async function terminateRunningWorkflows(): Promise<void> {
  await terminate(await Promise.all(started.map((entry) => runningOf(entry))));
}

beforeEach(() => {
  started = [];
  patches = WORKFLOWS.map(({ binding, workflow, lookup }) => {
    const entry = { binding, lookup, ids: new Set<string>() };
    started.push(entry);
    return patch(workflow, entry);
  });
});

afterEach(async () => {
  const leaked = (await Promise.all(started.map((entry) => runningOf(entry)))).filter(
    (entry) => entry.running.length > 0,
  );
  for (const previous of patches) restore(previous);
  await terminate(leaked);
  if (leaked.length === 0) return;
  const lines = leaked.map(
    ({ binding, running }) => `  ${binding}: ${running.map(({ id, status }) => `${id} is ${status}`).join(", ")}`,
  );
  throw new Error(
    `Workflow instances were still running when the test ended:\n${lines.join("\n")}\n` +
      "Every Workflow a test starts must reach complete, errored or terminated before the test ends. A running instance keeps Miniflare from disposing and stalls the vitest shard: docs/incidents/2026-10-09-vitest-shard-2-stall.md",
  );
});
