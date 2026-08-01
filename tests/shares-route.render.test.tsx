// @vitest-environment happy-dom
import { act, createElement, type FormEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockProps = { children?: ReactNode } & Record<string, unknown>;

const submit = vi.fn((event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/app/shares rendered conditional-action contract", () => {
  it("keeps Copy-or-Review beside an always-present, two-step Revoke in every state", async () => {
    const shares = [
      {
        id: "approved-report",
        url: "https://0509.io/share/approved",
        resourceLabel: "Report",
        mode: "Snapshot",
        state: "Approved current evidence",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "expired-report",
        url: "https://0509.io/share/expired",
        resourceLabel: "Report",
        mode: "Snapshot",
        state: "Approval expired · review again",
        recoveryPath: "/app/reports/watchlist:watch-1",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "collection-snapshot",
        url: "https://0509.io/share/snapshot",
        resourceLabel: "Collection",
        mode: "Snapshot",
        state: "Snapshot",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "watchlist-live",
        url: "https://0509.io/share/live",
        resourceLabel: "Watchlist",
        mode: "Live view",
        state: "Live view",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: null,
      },
    ];
    const { container, root } = await renderShares(shares);

    try {
      const rows = [...container.querySelectorAll<HTMLElement>(".f9-wk-row")];
      expect(rows).toHaveLength(4);
      expect(container.querySelectorAll('input[name="intent"][value="revoke-share"]')).toHaveLength(
        4,
      );
      expect(buttonsNamed(container, "Revoke")).toHaveLength(4);
      expect(buttonsNamed(container, "Copy link")).toHaveLength(3);
      expect(container.querySelectorAll('a[href="/app/reports/watchlist:watch-1"]')).toHaveLength(1);
      expect(container.textContent).not.toContain("Upgrade");
      expect(container.textContent).toContain("4 links shown");
      expect(container.textContent).not.toContain("4 active links");
      expect(container.textContent).toContain(
        "Approval-expired report links stay unavailable; reviewing again creates a new link to share.",
      );

      const approved = rowNamed(rows, "Report · Snapshot", "Approved");
      expect(approved.querySelector(".f9-wk-st")?.className).toContain("is-on");
      expect(approved.querySelector('a[href="https://0509.io/share/approved"]')).not.toBeNull();
      expect(buttonsNamed(approved, "Copy link")).toHaveLength(1);
      expect(buttonsNamed(approved, "Revoke")).toHaveLength(1);
      expect(approved.textContent).not.toContain("Review report");

      const expired = rowNamed(rows, "Report · Snapshot", "Expired");
      expect(expired.querySelector(".f9-wk-st")?.className).toContain("is-bad");
      expect(expired.textContent).toContain(
        "This link stays unavailable. Review the evidence to create a new link.",
      );
      expect(expired.querySelector('a[href="https://0509.io/share/expired"]')).toBeNull();
      expect(buttonsNamed(expired, "Copy link")).toHaveLength(0);
      expect(expired.textContent).toContain("Review report");
      expect(buttonsNamed(expired, "Revoke")).toHaveLength(1);

      const snapshot = rowNamed(rows, "Collection · Snapshot", "Snapshot");
      expect(snapshot.querySelector(".f9-wk-st")?.className).toBe("f9-wk-st");
      expect(snapshot.querySelector('a[href="https://0509.io/share/snapshot"]')).not.toBeNull();
      expect(buttonsNamed(snapshot, "Copy link")).toHaveLength(1);
      expect(buttonsNamed(snapshot, "Revoke")).toHaveLength(1);

      const live = rowNamed(rows, "Watchlist · Live view", "Live view");
      expect(live.querySelector(".f9-wk-st")?.className).toBe("f9-wk-st");
      expect(live.querySelector('a[href="https://0509.io/share/live"]')).not.toBeNull();
      expect(buttonsNamed(live, "Copy link")).toHaveLength(1);
      expect(buttonsNamed(live, "Revoke")).toHaveLength(1);
      expect(live.textContent).toContain("No expiry");

      const revoke = buttonsNamed(expired, "Revoke")[0];
      await act(async () => revoke.click());
      expect(submit).not.toHaveBeenCalled();
      const confirm = buttonsNamed(expired, "Confirm — revoke link?")[0];
      expect(confirm).toBeInstanceOf(HTMLButtonElement);
      expect(confirm.className).toContain("f9-confirm-armed");

      await act(async () => confirm.click());
      expect(submit).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

async function renderShares(shares: unknown[]) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: ({ children, method: _method, ...props }: MockProps) =>
        React.createElement("form", { ...props, onSubmit: submit }, children),
      Link: ({ children, prefetch: _prefetch, to, ...props }: MockProps & { to?: string }) =>
        React.createElement("a", { ...props, href: to }, children),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue({ shares }),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });

  const { default: SharesRoute } = await import("~/routes/app.shares");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(createElement(SharesRoute));
  });
  return { container, root };
}

function buttonsNamed(root: HTMLElement, name: string) {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.textContent?.trim() === name,
  );
}

function rowNamed(rows: HTMLElement[], name: string, status: string) {
  const row = rows.find(
    (candidate) =>
      candidate.querySelector(".f9-wk-nm")?.textContent?.trim() === name &&
      candidate.querySelector(".f9-wk-st")?.textContent?.trim() === status,
  );
  if (!row) {
    throw new Error(`Missing rendered share row: ${name} / ${status}`);
  }
  return row;
}
