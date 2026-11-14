import { bindings, defineConfig, exports } from "cf/config";

// Config for the J1/J2 mail-sink Worker (0509#3927). It is a separate Worker
// with its own name and custom domain, same fixture shape as fixture.0509.in in
// docs/REBUILD-DONE.md J8: Email Routing delivers e2e@0509.io to the `email`
// handler, and the Playwright suite reads messages back over HTTPS.
//
// The mailbox is a SQLite Durable Object, one instance per recipient
// (0509#4210). Workers KV cached a missing key for 60s, so the runner read
// 404 for the whole poll after the write had landed. Tag v1 creates the
// class; cf applies it on deploy. There is no KV binding.
export default defineConfig({
  worker: {
    name: "0509-e2e-inbox",
    compatibilityDate: "2026-09-16",
    entrypoint: "./index.ts",
    observability: { enabled: true },
    domains: ["e2e-inbox.0509.io"],
    env: {
      INBOX: bindings.durableObject({ worker: "0509-e2e-inbox", exportName: "InboxMailbox" }),
    },
    exports: {
      InboxMailbox: exports.durableObject({ storage: "sqlite" }),
    },
  },
});
