import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("../../app/lib/auth.server", () => ({
  createAuth: () => ({ handler: async () => new Response(null, { status: 200 }) }),
}));

import type { AccountDeleteProgress } from "../../app/lib/account-delete.server";
import Login from "../../app/routes/login";

function render(deleted: { id: string | null; progress: AccountDeleteProgress | null }): string {
  const Stub = createRoutesStub([{ id: "routes/login", path: "/login", Component: Login }]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: ["/login"],
      hydrationData: {
        loaderData: { "routes/login": { ...deleted, turnstileSiteKey: "1x00000000000000000000BB" } },
      },
    }),
  );
}

describe("Login account-delete progress", () => {
  it("says nothing extra without a deleted id", () => {
    expect(render({ id: null, progress: null })).not.toContain('data-delete="progress"');
  });

  it("says nothing extra when the Workflow instance is gone", () => {
    expect(render({ id: "gone", progress: null })).not.toContain('data-delete="progress"');
  });

  it("shows the rows removed and the files still removing, with Check again", () => {
    const html = render({ id: "wf-1", progress: { rows: "removed", files: "removing", deleted: null } });
    expect(html).toContain('data-delete="progress"');
    expect(html).toContain("Your account is deleted");
    expect(html).toContain("Brands, signals, briefs, send history, card, API keys and connected apps: removed");
    expect(html).toContain("Snapshots and screenshots: still removing");
    expect(html).toContain('href="/login?deleted=wf-1"');
    expect(html).toContain("Check again");
  });

  it("counts the files removed and drops Check again", () => {
    const html = render({ id: "wf-2", progress: { rows: "removed", files: "removed", deleted: 3 } });
    expect(html).toContain("Snapshots and screenshots: removed (3 files)");
    expect(html).not.toContain("Check again");
  });

  it("says removed without a count when the Workflow reported none", () => {
    const html = render({ id: "wf-3", progress: { rows: "removed", files: "removed", deleted: null } });
    expect(html).toContain("Snapshots and screenshots: removed");
    expect(html).not.toContain("removed (");
  });

  it("tells the customer to write to support when the Workflow stopped", () => {
    const html = render({ id: "wf-4", progress: { rows: "removed", files: "failed", deleted: null } });
    expect(html).toContain(
      "Snapshots and screenshots: stopped. Write to support@0509.io and we&#x27;ll finish it.",
    );
  });
});
