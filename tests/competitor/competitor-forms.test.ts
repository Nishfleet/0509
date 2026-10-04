import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  forget: vi.fn(),
  site: vi.fn(),
  youtube: vi.fn(),
  intent: vi.fn(),
}));

vi.mock("../../app/lib/competitor-forget.server", () => ({ forgetCompetitor: calls.forget }));
vi.mock("../../app/lib/competitor-site.server", () => ({ saveCompetitorSite: calls.site }));
vi.mock("../../app/lib/competitor-youtube.server", () => ({ saveCompetitorYoutube: calls.youtube }));
vi.mock("../../app/lib/competitors.server", () => ({ handleCompetitorIntent: calls.intent }));

import { handleCompetitorForm } from "../../app/lib/competitor-forms.server";

const WS = "ws-1";
const ENTITY = "ent-1";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const CLEAN = { forgetError: null, youtubeError: null, siteError: null };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("handleCompetitorForm", () => {
  it("passes the typed name to forget and reports a mismatch under the forget field", async () => {
    calls.forget.mockResolvedValue("mismatch");
    const out = await handleCompetitorForm(WS, ENTITY, form({ intent: "forget", confirm: "Rival" }));
    expect(calls.forget).toHaveBeenCalledWith(WS, ENTITY, "Rival");
    expect(out).toEqual({
      ...CLEAN,
      message: null,
      forgetError: "That doesn't match the name. Type it exactly as shown.",
    });
  });

  it("redirects to the list once the competitor is forgotten", async () => {
    calls.forget.mockResolvedValue("forgotten");
    const thrown = await handleCompetitorForm(WS, ENTITY, form({ intent: "forget", confirm: "Rival" })).catch(
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("location")).toBe("/app/competitors");
  });

  it("answers 404 when the competitor is not tracked", async () => {
    calls.forget.mockResolvedValue("missing");
    const thrown = await handleCompetitorForm(WS, ENTITY, form({ intent: "forget" })).catch((error: unknown) => error);
    expect((thrown as Response).status).toBe(404);
  });

  it.each([
    ["youtube", calls.youtube, "youtube", "youtubeError"],
    ["site", calls.site, "site", "siteError"],
  ] as const)(
    "hands the %s field to its saver and shows the saver's refusal",
    async (intent, saver, name, errorKey) => {
      saver.mockResolvedValueOnce({ ok: false, message: "No." }).mockResolvedValueOnce({ ok: true });
      const refused = await handleCompetitorForm(WS, ENTITY, form({ intent, [name]: "x" }));
      expect(saver).toHaveBeenCalledWith(WS, ENTITY, "x");
      expect(refused).toEqual({ ...CLEAN, message: null, [errorKey]: "No." });
      expect(await handleCompetitorForm(WS, ENTITY, form({ intent, [name]: "y" }))).toEqual({
        ...CLEAN,
        message: null,
      });
    },
  );

  it("treats a missing field as empty text", async () => {
    calls.site.mockResolvedValue({ ok: true });
    await handleCompetitorForm(WS, ENTITY, form({ intent: "site" }));
    expect(calls.site).toHaveBeenCalledWith(WS, ENTITY, "");
  });

  it.each([
    ["on", "on"],
    ["off", "off"],
    ["anything-else", ""],
  ])("turns intent %s into the %j toggle for the competitor", async (intent, expected) => {
    calls.intent.mockResolvedValue({ message: "Done." });
    const out = await handleCompetitorForm(WS, ENTITY, form({ intent }));
    const sent = calls.intent.mock.calls[0]?.[1] as FormData;
    expect([sent.get("intent"), sent.get("entityId")]).toEqual([expected, ENTITY]);
    expect(out).toEqual({ ...CLEAN, message: "Done." });
  });
});
