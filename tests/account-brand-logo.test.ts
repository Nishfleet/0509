import { Buffer } from "node:buffer";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-04-02 18:30:00",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-07-14T00:00:00.000Z",
  },
};

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9];
const WEBP_BYTES = [
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
];

function createContext() {
  return { cloudflare: { env: {} } };
}

function logoFile(bytes: number[], name: string, type: string) {
  return new File([Uint8Array.from(bytes)], name, { type });
}

function expectedDataUrl(type: string, bytes: number[]) {
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

function mockBrandingAction(plan: "starter" | "agency" = "agency") {
  const upsertWorkspaceBranding = vi.fn().mockImplementation(
    async (_env: unknown, _userId: string, input: Record<string, unknown>) => ({
      brandName: typeof input.brandName === "string" && input.brandName.trim()
        ? input.brandName.trim()
        : null,
      brandWebsite: null,
      brandLogo: Object.prototype.hasOwnProperty.call(input, "brandLogo")
        ? input.brandLogo
        : "data:image/png;base64,ZXhpc3Rpbmc=",
    }),
  );

  vi.doMock("~/lib/auth.server", () => ({
    requireSession: vi.fn().mockResolvedValue(session),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue(plan),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getWorkspaceBranding: vi.fn(),
    upsertWorkspaceBranding,
  }));

  return upsertWorkspaceBranding;
}

async function submitBranding(formData: FormData) {
  const { action } = await import("~/routes/app.account");
  return action({
    context: createContext(),
    request: new Request("http://localhost/app/account", {
      method: "POST",
      body: formData,
    }),
  } as never);
}

function brandingForm() {
  const formData = new FormData();
  formData.set("intent", "save-report-branding");
  formData.set("brandName", "Northwind Growth");
  return formData;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/better-auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/e2e-auth.server");
  vi.doUnmock("~/lib/email-verification.server");
  vi.doUnmock("~/lib/plan.server");
});

describe("account agency logo action", () => {
  it.each([
    ["PNG", PNG_BYTES, "logo.png", "image/png"],
    ["JPEG", JPEG_BYTES, "logo.jpg", "image/jpeg"],
    ["WebP", WEBP_BYTES, "logo.webp", "image/webp"],
  ])("accepts a small %s whose MIME matches its raster signature", async (_label, bytes, name, type) => {
    const upsertWorkspaceBranding = mockBrandingAction();
    const formData = brandingForm();
    formData.set("brandLogo", logoFile(bytes, name, type));

    const result = await submitBranding(formData);

    expect(upsertWorkspaceBranding).toHaveBeenCalledWith(expect.anything(), "user-1", {
      brandName: "Northwind Growth",
      brandLogo: expectedDataUrl(type, bytes),
    });
    expect(result).toMatchObject({ ok: true, intent: "save-report-branding" });
  });

  it.each([
    ["MIME and content mismatch", logoFile(PNG_BYTES, "spoofed.jpg", "image/jpeg")],
    ["SVG", new File(["<svg></svg>"], "logo.svg", { type: "image/svg+xml" })],
    ["empty named image", new File([], "empty.png", { type: "image/png" })],
    ["oversized image", new File([new Uint8Array(48_001)], "large.png", { type: "image/png" })],
  ])("rejects %s without writing", async (_label, file) => {
    const upsertWorkspaceBranding = mockBrandingAction();
    const formData = brandingForm();
    formData.set("brandLogo", file);

    const result = await submitBranding(formData);

    expect(result).toMatchObject({
      ok: false,
      intent: "save-report-branding",
      error: "invalid_brand_logo",
    });
    expect(upsertWorkspaceBranding).not.toHaveBeenCalled();
  });

  it("rejects a malformed non-file logo field without writing", async () => {
    const upsertWorkspaceBranding = mockBrandingAction();
    const formData = brandingForm();
    formData.set("brandLogo", "not-a-file");

    const result = await submitBranding(formData);

    expect(result).toMatchObject({ ok: false, error: "invalid_brand_logo" });
    expect(upsertWorkspaceBranding).not.toHaveBeenCalled();
  });

  it("preserves the current logo when no new file is selected", async () => {
    const upsertWorkspaceBranding = mockBrandingAction();

    await submitBranding(brandingForm());

    expect(upsertWorkspaceBranding).toHaveBeenCalledWith(expect.anything(), "user-1", {
      brandName: "Northwind Growth",
    });
  });

  it("clears the current logo only when removal is explicit", async () => {
    const upsertWorkspaceBranding = mockBrandingAction();
    const formData = brandingForm();
    formData.set("removeBrandLogo", "true");

    await submitBranding(formData);

    expect(upsertWorkspaceBranding).toHaveBeenCalledWith(expect.anything(), "user-1", {
      brandName: "Northwind Growth",
      brandLogo: null,
    });
  });

  it("applies the plan gate before an uploaded logo can be written", async () => {
    const upsertWorkspaceBranding = mockBrandingAction("starter");
    const formData = brandingForm();
    formData.set("brandLogo", logoFile(PNG_BYTES, "logo.png", "image/png"));

    const result = await submitBranding(formData);

    expect(result).toMatchObject({ ok: false, error: "plan_gated" });
    expect(upsertWorkspaceBranding).not.toHaveBeenCalled();
  });
});

describe("account agency logo loader", () => {
  function mockLoader(plan: "starter" | "agency") {
    const getWorkspaceBranding = vi.fn().mockResolvedValue({
      brandName: "Northwind Growth",
      brandWebsite: "https://northwind.example",
      brandLogo: "data:image/png;base64,iVBORw0KGgo=",
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthPasskeyEnabled: vi.fn().mockReturnValue(false),
      listBetterAuthPasskeys: vi.fn(),
      listBetterAuthSessions: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/data.server", () => ({ getWorkspaceBranding }));
    vi.doMock("~/lib/e2e-auth.server", () => ({
      isE2ETestSessionId: vi.fn().mockReturnValue(false),
    }));
    vi.doMock("~/lib/email-verification.server", () => ({
      isUserEmailVerified: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue(plan),
    }));

    return getWorkspaceBranding;
  }

  it("returns the current logo to the Agency account UI", async () => {
    mockLoader("agency");
    const { loader } = await import("~/routes/app.account");

    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/account"),
    } as never);

    expect(result.brandLogo).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("suppresses stored report identity after a plan downgrade", async () => {
    mockLoader("starter");
    const { loader } = await import("~/routes/app.account");

    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/account"),
    } as never);

    expect(result.brandName).toBeNull();
    expect(result.brandLogo).toBeNull();
  });
});

describe("account agency logo UI", () => {
  async function renderAccount(input: {
    actionData?: Record<string, unknown>;
    plan?: "starter" | "agency";
  } = {}) {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
        Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: to }, children),
        useActionData: vi.fn().mockReturnValue(input.actionData),
        useLoaderData: vi.fn().mockReturnValue({
          email: "owner@example.com",
          emailVerified: true,
          name: "Owner",
          sessionExpiresAt: "2026-07-14T00:00:00.000Z",
          plan: input.plan ?? "agency",
          brandName: "Northwind Growth",
          brandWebsite: "https://northwind.example",
          brandLogo: "data:image/png;base64,iVBORw0KGgo=",
          passkeys: [],
          passkeysEnabled: false,
          passkeyControlsMessage: null,
          activeSessions: [],
          sessionControlsMessage: null,
        }),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      };
    });

    const { default: AccountRoute } = await import("~/routes/app.account");
    return renderToStaticMarkup(createElement(AccountRoute));
  }

  it("renders a labeled multipart native file control, help, preview, and remove control", async () => {
    const markup = await renderAccount();

    expect(markup).toContain('encType="multipart/form-data"');
    expect(markup).toContain('type="file"');
    expect(markup).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(markup).toContain("Agency logo");
    expect(markup).toContain('aria-describedby="brand-logo-help"');
    expect(markup).toContain('id="brand-logo-help"');
    expect(markup).toContain("PNG, JPEG, or WebP");
    expect(markup).toContain('alt="Northwind Growth logo"');
    expect(markup).toContain("Remove current logo");
  });

  it("announces save success politely and errors as alerts", async () => {
    const success = await renderAccount({
      actionData: {
        ok: true,
        intent: "save-report-branding",
        message: "Agency branding saved.",
      },
    });
    expect(success).toContain('role="status"');
    expect(success).toContain('aria-live="polite"');

    vi.resetModules();
    const error = await renderAccount({
      actionData: {
        ok: false,
        intent: "save-report-branding",
        error: "invalid_brand_logo",
        message: "Choose a valid logo.",
      },
    });
    expect(error).toContain('role="alert"');
    expect(error).toContain('aria-invalid="true"');
  });

  it("does not render stored Agency identity controls after downgrade", async () => {
    const markup = await renderAccount({ plan: "starter" });

    expect(markup).not.toContain('alt="Northwind Growth logo"');
    expect(markup).not.toContain('name="brandLogo"');
    expect(markup).toContain("Branded reports are part of Agency");
  });
});
