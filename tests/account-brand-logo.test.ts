import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
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

const PNG_BYTES = Array.from(
Buffer.from(
"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
"base64",
),
);
const PNG_WITH_ZERO_LENGTH_IDAT_BYTES = Array.from(
Buffer.from(
"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAElEQVQ1rwYeAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
"base64",
),
);
const PNG_WITH_UNKNOWN_CRITICAL_CHUNK_BYTES = Array.from(
Buffer.from(
"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAEFCQ0TbFyClAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
"base64",
),
);
const APNG_CHUNK_BYTES = [
["acTL", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACGFjVEwAAAACAAAAAPONk3AAAAANSURBVHicY/jPwPAfAAUAAf+JmT0dAAAAAElFTkSuQmCC"],
["fcTL", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAGmZjVEwAAAAAAAAAAQAAAAEAAAAAAAAAAAABAAoAAFp/MNAAAAANSURBVHicY/jPwPAfAAUAAf+JmT0dAAAAAElFTkSuQmCC"],
["fdAT", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAABWZkQVQAAAAAAOiydu0AAAANSURBVHicY/jPwPAfAAUAAf+JmT0dAAAAAElFTkSuQmCC"],
].map(([chunk, encoded]) => [chunk, Array.from(Buffer.from(encoded, "base64"))] as const);
const JPEG_BYTES = Array.from(
Buffer.from(
"/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAABAAEDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z",
"base64",
),
);
const WEBP_BYTES = Array.from(
Buffer.from(
"UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAgA0JaACdLoB+AADsAD+8Oj3/yC5YXXI1/8gP+QH/ID/+PIAAAA=",
"base64",
),
);
const WEBP_LOSSLESS_BYTES = Array.from(
Buffer.from("UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ9Y/+ByKi/wEA", "base64"),
);
const ANIMATED_WEBP_BYTES = Array.from(
Buffer.from("UklGRhYAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAA", "base64"),
);
const RESERVED_FLAG_WEBP_BYTES = [...ANIMATED_WEBP_BYTES];
RESERVED_FLAG_WEBP_BYTES[20] = 1;
const ZERO_DIMENSION_WEBP = [...WEBP_BYTES];
ZERO_DIMENSION_WEBP[26] = 0;
const ZERO_DIMENSION_JPEG = [...JPEG_BYTES];
ZERO_DIMENSION_JPEG[192] = 0;
ZERO_DIMENSION_JPEG[193] = 0;

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

async function submitAccountRequest(request: Request) {
const { action } = await import("~/routes/app.account");
return action({
context: createContext(),
request,
} as never);
}

async function submitBranding(formData: FormData) {
return submitAccountRequest(
new Request("http://localhost/app/account", {
method: "POST",
body: formData,
}),
);
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
vi.doUnmock("~/lib/plan-feature-gate.server");
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

it("accepts a minimal lossless WebP", async () => {
const upsertWorkspaceBranding = mockBrandingAction();
const formData = brandingForm();
formData.set("brandLogo", logoFile(WEBP_LOSSLESS_BYTES, "logo-lossless.webp", "image/webp"));

const result = await submitBranding(formData);

expect(upsertWorkspaceBranding).toHaveBeenCalledWith(expect.anything(), "user-1", {
brandName: "Northwind Growth",
brandLogo: expectedDataUrl("image/webp", WEBP_LOSSLESS_BYTES),
});
expect(result).toMatchObject({ ok: true, intent: "save-report-branding" });
});

it("accepts legal zero-length IDAT chunks when the concatenated stream is non-empty", async () => {
const upsertWorkspaceBranding = mockBrandingAction();
const formData = brandingForm();
formData.set("brandLogo", logoFile(PNG_WITH_ZERO_LENGTH_IDAT_BYTES, "logo-zero-idat.png", "image/png"));

const result = await submitBranding(formData);

expect(upsertWorkspaceBranding).toHaveBeenCalledWith(expect.anything(), "user-1", {
brandName: "Northwind Growth",
brandLogo: expectedDataUrl("image/png", PNG_WITH_ZERO_LENGTH_IDAT_BYTES),
});
expect(result).toMatchObject({ ok: true, intent: "save-report-branding" });
});

it("rejects metadata-declared oversized multipart before parsing or checking the plan", async () => {
const upsertWorkspaceBranding = mockBrandingAction();
const requireWorkspacePlanFeature = vi.fn();
vi.doMock("~/lib/plan-feature-gate.server", () => ({ requireWorkspacePlanFeature }));
const request = new Request("http://localhost/app/account", {
method: "POST",
headers: {
"content-type": "multipart/form-data; boundary=oversized",
"content-length": "1000000",
},
body: "not parsed",
});
const parseFormData = vi
.spyOn(request, "formData")
.mockRejectedValue(new Error("oversized request must not reach formData"));

const result = await submitAccountRequest(request);

expect(result).toEqual({
ok: false,
intent: "save-report-branding",
error: "invalid_brand_logo",
message: "Logo must be 48 KB or smaller.",
});
expect(parseFormData).not.toHaveBeenCalled();
expect(requireWorkspacePlanFeature).not.toHaveBeenCalled();
expect(upsertWorkspaceBranding).not.toHaveBeenCalled();
});

it("streams and rejects oversized multipart when content-length is absent", async () => {
const upsertWorkspaceBranding = mockBrandingAction();
const requireWorkspacePlanFeature = vi.fn();
vi.doMock("~/lib/plan-feature-gate.server", () => ({ requireWorkspacePlanFeature }));
const formData = brandingForm();
formData.set(
"brandLogo",
new File([new Uint8Array(100_000)], "oversized.png", { type: "image/png" }),
);
const request = new Request("http://localhost/app/account", {
method: "POST",
body: formData,
});
expect(request.headers.get("content-length")).toBeNull();
const parseFormData = vi
.spyOn(request, "formData")
.mockRejectedValue(new Error("unbounded request must not reach formData"));

const result = await submitAccountRequest(request);

expect(result).toEqual({
ok: false,
intent: "save-report-branding",
error: "invalid_brand_logo",
message: "Logo must be 48 KB or smaller.",
});
expect(parseFormData).not.toHaveBeenCalled();
expect(requireWorkspacePlanFeature).not.toHaveBeenCalled();
expect(upsertWorkspaceBranding).not.toHaveBeenCalled();
});

it.each([
["MIME and content mismatch", logoFile(PNG_BYTES, "spoofed.jpg", "image/jpeg")],
["SVG", new File(["<svg></svg>"], "logo.svg", { type: "image/svg+xml" })],
["signature-only PNG", logoFile(PNG_BYTES.slice(0, 8), "truncated.png", "image/png")],
["truncated JPEG", logoFile(JPEG_BYTES.slice(0, 3), "truncated.jpg", "image/jpeg")],
["zero-dimension JPEG", logoFile(ZERO_DIMENSION_JPEG, "zero-dimension.jpg", "image/jpeg")],
["truncated WebP", logoFile(WEBP_BYTES.slice(0, 12), "truncated.webp", "image/webp")],
["zero-dimension WebP", logoFile(ZERO_DIMENSION_WEBP, "zero-dimension.webp", "image/webp")],
["malformed PNG chunk", logoFile(PNG_BYTES.slice(0, -4), "malformed.png", "image/png")],
["unknown critical PNG chunk", logoFile(PNG_WITH_UNKNOWN_CRITICAL_CHUNK_BYTES, "unknown-critical.png", "image/png")],
...APNG_CHUNK_BYTES.map(([chunk, bytes]) => [`APNG ${chunk} chunk`, logoFile(bytes, `animated-${chunk}.png`, "image/png")]),
["animated WebP", logoFile(ANIMATED_WEBP_BYTES, "animated.webp", "image/webp")],
["reserved-flag WebP", logoFile(RESERVED_FLAG_WEBP_BYTES, "reserved.webp", "image/webp")],
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

it("reports the retained logo when the brand name is cleared without a new file", async () => {
const upsertWorkspaceBranding = mockBrandingAction();
const formData = brandingForm();
formData.set("brandName", "");

const result = await submitBranding(formData);

expect(upsertWorkspaceBranding).toHaveBeenCalledWith(expect.anything(), "user-1", {
brandName: "",
});
expect(result).toEqual({
ok: true,
intent: "save-report-branding",
message: "Saved. Shared reports use your agency logo.",
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

describe("account security copy and passkey removal", () => {
  it("uses Better Auth's documented passkey deletion client method with accessible state", () => {
    const source = readFileSync("app/routes/app.account.tsx", "utf8");

    expect(source).toContain("authClient.passkey.deletePasskey({ id })");
    expect(source).toContain("Remove passkey");
    expect(source).toContain("Confirm — remove passkey?");
    expect(source).toContain("Passkey removed.");
    expect(source).toContain('aria-live="polite"');
  });

  it("describes account deletion as a support request rather than an in-app deletion", () => {
    const source = readFileSync("app/routes/app.account.tsx", "utf8");

    expect(source).toContain("support deletion request");
    expect(source).toContain("nothing is deleted automatically or in-app");
    expect(source).toContain("Support reviews and verifies the request");
    expect(source).not.toContain("Permanently removes your account");
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
	isE2EFixtureWorkspaceSession: vi.fn().mockReturnValue(false),
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
plan?: "free" | "scout" | "starter" | "agency";
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
useRevalidator: vi.fn().mockReturnValue({ revalidate: vi.fn(), state: "idle" }),
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

it("keeps completed workspaces on live competitor and brand actions", async () => {
const markup = await renderAccount();

expect(markup).toContain('href="/app/watchlists"');
expect(markup).toContain("Add competitor");
expect(markup).toContain('href="#brand-profile"');
expect(markup).toContain("update your own brand website");
expect(markup).not.toContain("/app#setup-checklist");
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

it.each(["free", "scout", "starter"] as const)(
"renders one quiet Agency-branding gate for %s without exposing stored identity controls",
async (plan) => {
const markup = await renderAccount({ plan });

expect(markup).not.toContain('alt="Northwind Growth logo"');
expect(markup).not.toContain('name="brandLogo"');
expect(markup).toContain("Branded reports are part of Agency");
expect(markup).toContain('class="f9-wk-btn"');
expect(markup.match(/See Agency plans/g)).toHaveLength(1);
},
);
});
