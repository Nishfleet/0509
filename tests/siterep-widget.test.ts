import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canUseSiteRepWidgetScript,
  hasSiteRepAuthCookie,
  installSiteRepWidget,
  isSiteRepWidgetIsolatedPath,
  normalizeSiteRepWidgetPathname,
  SITE_REP_WIDGET,
  SITE_REP_WIDGET_DELAY_MS,
  shouldLoadSiteRepWidget,
  shouldReloadForSiteRepWidgetDocument,
  siteRepWidgetForPathname,
  siteRepWidgetForRequestState,
  teardownSiteRepWidget,
} from "~/root";

type FakeWidgetWindow = {
  SiteRep: { uninstall: ReturnType<typeof vi.fn> };
  CiteRep: { uninstall: ReturnType<typeof vi.fn> };
  siterep?: { botId?: string; publicKey?: string; apiBase?: string };
};

function fakeWidgetDom() {
  const appended: Array<{ src?: string; defer?: boolean; dataset: Record<string, string>; removed: boolean }> = [];
  const ownedNode = { removed: false, remove: vi.fn(() => { ownedNode.removed = true; }) };
  const loaderNode = { removed: false, remove: vi.fn(() => { loaderNode.removed = true; }) };
  const widgetDocument = {
    createElement: vi.fn(() => {
      const element = { dataset: {}, removed: false } as (typeof appended)[number];
      appended.push(element);
      return element;
    }),
    body: {
      appendChild: vi.fn(),
    },
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === "[data-siterep-loader='0509']") return [loaderNode];
      if (selector === "[data-citerep-owned]") return [ownedNode];
      return [];
    }),
  };
  const widgetWindow: FakeWidgetWindow = {
    SiteRep: { uninstall: vi.fn() },
    CiteRep: { uninstall: vi.fn() },
  };

  return { appended, loaderNode, ownedNode, widgetDocument, widgetWindow };
}

describe("Site Rep widget install", () => {
  it("pins the public Site Rep workspace configuration for 0509", () => {
    expect(SITE_REP_WIDGET).toEqual({
      botId: "starter-0509-io",
      publicKey: "pk_ccc258247b8a4cb8a11b2afe4ddb38c2",
      apiBase: "https://siterep.net",
      src: "https://siterep.net/widget.js",
    });
  });

  it("loads only on public human-facing routes", () => {
    expect(normalizeSiteRepWidgetPathname("/help/")).toBe("/help");
    expect(normalizeSiteRepWidgetPathname("/compare/magicbrief///")).toBe("/compare/magicbrief");

    for (const pathname of [
      "/",
      "/help",
      "/help/",
      "/docs",
      "/docs/",
      "/status",
      "/changelog",
      "/trust",
      "/privacy",
      "/terms",
      "/compare/magicbrief",
      "/compare/magicbrief/",
      "/switch/magicbrief",
      "/switch/panoramata",
      "/switch/visualping",
    ]) {
      expect(shouldLoadSiteRepWidget(pathname), pathname).toBe(true);
    }

    for (const pathname of ["/search", "/search/"]) {
      expect(shouldLoadSiteRepWidget(pathname), pathname).toBe(false);
      expect(isSiteRepWidgetIsolatedPath(pathname), pathname).toBe(false);
    }

    for (const pathname of [
      "/auth/login",
      "/api/auth/callback/google",
      "/auth/reset-password",
      "/api/auth/passkey/verify-authentication",
      "/app",
      "/app/billing",
      "/api/health",
      "/api/v1",
      "/export/collection/example",
      "/team/accept",
      "/share/public-token",
      "/unsubscribe",
      "/.well-known/security.txt",
    ]) {
      expect(shouldLoadSiteRepWidget(pathname), pathname).toBe(false);
      expect(isSiteRepWidgetIsolatedPath(pathname), pathname).toBe(true);
    }
  });

  it("stays disabled for authenticated sessions", () => {
    expect(siteRepWidgetForPathname("/", null)).toEqual(SITE_REP_WIDGET);
    expect(siteRepWidgetForPathname("/", undefined)).toBeNull();
    expect(siteRepWidgetForPathname("/", { userId: "user_123" } as never)).toBeNull();
    expect(siteRepWidgetForPathname("/search", { userId: "user_123" } as never)).toBeNull();
  });

  it("stays disabled when auth cookies are present but session lookup is anonymous", () => {
    const request = new Request("https://0509.io/", {
      headers: { cookie: "better-auth.session_token=session-123" },
    });

    expect(hasSiteRepAuthCookie(request)).toBe(true);
    expect(canUseSiteRepWidgetScript(request)).toBe(false);
    expect(siteRepWidgetForRequestState("/", { session: null, hasAuthCookie: true, allowsSiteRepScript: false })).toBeNull();
    expect(siteRepWidgetForRequestState("/", { session: null, hasAuthCookie: false, allowsSiteRepScript: true })).toEqual(
      SITE_REP_WIDGET,
    );
    expect(siteRepWidgetForRequestState("/", { session: null, hasAuthCookie: false, allowsSiteRepScript: false })).toBeNull();
    expect(siteRepWidgetForRequestState("/", undefined)).toBeNull();
  });

  it("reloads anonymous public widget routes reached from strict documents", () => {
    expect(
      shouldReloadForSiteRepWidgetDocument(
        "/",
        { session: null, hasAuthCookie: false },
        false,
      ),
    ).toBe(true);
    expect(
      shouldReloadForSiteRepWidgetDocument(
        "/",
        { session: null, hasAuthCookie: false },
        true,
      ),
    ).toBe(false);
    expect(
      shouldReloadForSiteRepWidgetDocument(
        "/",
        { session: { userId: "user_123" } as never, hasAuthCookie: false },
        true,
      ),
    ).toBe(true);
    expect(
      shouldReloadForSiteRepWidgetDocument(
        "/search",
        { session: null, hasAuthCookie: true },
        true,
      ),
    ).toBe(true);
    expect(
      shouldReloadForSiteRepWidgetDocument(
        "/",
        { session: null, hasAuthCookie: true },
        false,
      ),
    ).toBe(false);
    expect(
      shouldReloadForSiteRepWidgetDocument(
        "/",
        { session: { userId: "user_123" } as never, hasAuthCookie: false },
        false,
      ),
    ).toBe(false);
    expect(
      shouldReloadForSiteRepWidgetDocument(
        "/app",
        { session: null, hasAuthCookie: false },
        false,
      ),
    ).toBe(false);
    expect(
      shouldReloadForSiteRepWidgetDocument(
        "/auth/login",
        { session: null, hasAuthCookie: false },
        true,
      ),
    ).toBe(true);
    expect(
      shouldReloadForSiteRepWidgetDocument(
        "/app",
        { session: { userId: "user_123" } as never, hasAuthCookie: true },
        true,
      ),
    ).toBe(true);
    expect(
      shouldReloadForSiteRepWidgetDocument(
        "/auth/login",
        { session: null, hasAuthCookie: false },
        false,
      ),
    ).toBe(false);
  });

  it("installs one documented widget script and configures the public widget", () => {
    const { appended, widgetDocument, widgetWindow } = fakeWidgetDom();

    installSiteRepWidget(SITE_REP_WIDGET, widgetWindow as never, widgetDocument as never);

    expect(widgetWindow.siterep).toEqual({
      botId: SITE_REP_WIDGET.botId,
      publicKey: SITE_REP_WIDGET.publicKey,
      apiBase: SITE_REP_WIDGET.apiBase,
    });
    expect(widgetDocument.createElement).toHaveBeenCalledWith("script");
    expect(widgetDocument.body.appendChild).toHaveBeenCalledTimes(1);
    expect(appended[0]).toMatchObject({
      src: SITE_REP_WIDGET.src,
      defer: true,
      dataset: {
        siterepLoader: "0509",
        botId: SITE_REP_WIDGET.botId,
        publicKey: SITE_REP_WIDGET.publicKey,
        apiBase: SITE_REP_WIDGET.apiBase,
      },
    });
  });

  it("tears down loader config, scripts, and owned widget nodes", () => {
    const { loaderNode, ownedNode, widgetDocument, widgetWindow } = fakeWidgetDom();
    widgetWindow.siterep = { botId: SITE_REP_WIDGET.botId };

    teardownSiteRepWidget(widgetWindow as never, widgetDocument as never);

    expect(widgetWindow.SiteRep.uninstall).toHaveBeenCalled();
    expect(widgetWindow.CiteRep.uninstall).toHaveBeenCalled();
    expect(widgetWindow.siterep).toBeUndefined();
    expect(loaderNode.remove).toHaveBeenCalled();
    expect(ownedNode.remove).toHaveBeenCalled();
  });

  it("keeps cleanup best-effort when a third-party uninstall throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loaderNode, ownedNode, widgetDocument, widgetWindow } = fakeWidgetDom();
    widgetWindow.SiteRep.uninstall.mockImplementation(() => {
      throw new Error("site rep unavailable");
    });
    widgetWindow.siterep = { botId: SITE_REP_WIDGET.botId };

    teardownSiteRepWidget(widgetWindow as never, widgetDocument as never);

    expect(widgetWindow.CiteRep.uninstall).toHaveBeenCalled();
    expect(widgetWindow.siterep).toBeUndefined();
    expect(loaderNode.remove).toHaveBeenCalled();
    expect(ownedNode.remove).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  describe("deferred install (dogfood a08b8427701d: slow resource requests on home)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("still installs synchronously by default and with an explicit zero delay", () => {
      const defaultDom = fakeWidgetDom();
      installSiteRepWidget(SITE_REP_WIDGET, defaultDom.widgetWindow as never, defaultDom.widgetDocument as never);
      expect(defaultDom.widgetDocument.body.appendChild).toHaveBeenCalledTimes(1);

      const explicitZeroDom = fakeWidgetDom();
      installSiteRepWidget(
        SITE_REP_WIDGET,
        explicitZeroDom.widgetWindow as never,
        explicitZeroDom.widgetDocument as never,
        { delayMs: 0 },
      );
      expect(explicitZeroDom.widgetDocument.body.appendChild).toHaveBeenCalledTimes(1);
    });

    it("installs the documented widget script exactly SITE_REP_WIDGET_DELAY_MS after the call", () => {
      vi.useFakeTimers();
      const { appended, widgetDocument, widgetWindow } = fakeWidgetDom();

      const cleanup = installSiteRepWidget(
        SITE_REP_WIDGET,
        widgetWindow as never,
        widgetDocument as never,
        { delayMs: SITE_REP_WIDGET_DELAY_MS },
      );
      expect(cleanup).toBeTypeOf("function");
      expect(widgetDocument.body.appendChild).not.toHaveBeenCalled();

      vi.advanceTimersByTime(SITE_REP_WIDGET_DELAY_MS - 1);
      expect(widgetDocument.body.appendChild).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(widgetDocument.body.appendChild).toHaveBeenCalledTimes(1);
      expect(widgetWindow.siterep).toEqual({
        botId: SITE_REP_WIDGET.botId,
        publicKey: SITE_REP_WIDGET.publicKey,
        apiBase: SITE_REP_WIDGET.apiBase,
      });
      expect(appended[0]).toMatchObject({
        src: SITE_REP_WIDGET.src,
        defer: true,
        dataset: {
          siterepLoader: "0509",
          botId: SITE_REP_WIDGET.botId,
          publicKey: SITE_REP_WIDGET.publicKey,
          apiBase: SITE_REP_WIDGET.apiBase,
        },
      });
    });

    it("cleanup cancels a pending deferred install so nothing is appended later", () => {
      vi.useFakeTimers();
      const { widgetDocument, widgetWindow } = fakeWidgetDom();

      const cleanup = installSiteRepWidget(
        SITE_REP_WIDGET,
        widgetWindow as never,
        widgetDocument as never,
        { delayMs: SITE_REP_WIDGET_DELAY_MS },
      );
      expect(cleanup).toBeTypeOf("function");
      cleanup?.();

      vi.advanceTimersByTime(SITE_REP_WIDGET_DELAY_MS * 2);
      expect(widgetDocument.body.appendChild).not.toHaveBeenCalled();
      expect(widgetWindow.siterep).toBeUndefined();
    });
  });
});
