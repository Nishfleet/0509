import { afterEach, describe, expect, it, vi } from "vitest";

import type { Subject } from "../../app/lib/identity/normalise";
import {
  groundRefusalFromDocument,
  readSubjectGroundTruth,
} from "../../app/lib/jev/subject-ground-truth.server";

const instagram = (body: string, status = 200, finalUrl = "https://www.instagram.com/example/") =>
  groundRefusalFromDocument({ platform: "instagram", status, finalUrl, body });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("groundRefusalFromDocument", () => {
  it("refuses an Instagram account the page marks private", () => {
    expect(instagram('{"is_private":true}')).toBe("private");
  });

  it("does not refuse an Instagram account the page marks public", () => {
    expect(instagram('{"is_private":false,"biography":"Log in"}')).toBeNull();
  });

  it("does not guess when the private flag disagrees with itself", () => {
    expect(instagram('{"is_private":true}{"is_private":false}')).toBeNull();
  });

  it("refuses a TikTok account marked as an under-13 ftc account", () => {
    expect(
      groundRefusalFromDocument({
        platform: "tiktok",
        status: 200,
        finalUrl: "https://www.tiktok.com/@example",
        body: '{"ftc":true,"privateAccount":false}',
      }),
    ).toBe("minor");
  });

  it("refuses a TikTok account marked private", () => {
    expect(
      groundRefusalFromDocument({
        platform: "tiktok",
        status: 200,
        finalUrl: "https://www.tiktok.com/@example",
        body: '{"ftc":false,"privateAccount":true}',
      }),
    ).toBe("private");
  });

  it("refuses an X account whose privacy block says protected", () => {
    const body = "privacy:$R[30]={protected:!0},privacy:$R[31]={protected:!0}";
    expect(
      groundRefusalFromDocument({
        platform: "x",
        status: 200,
        finalUrl: "https://x.com/example",
        body,
      }),
    ).toBe("private");
  });

  it("does not refuse an X account whose privacy blocks agree it is public", () => {
    const body = "privacy:$R[30]={protected:!1} privacy:$R[4]={protected:!1}";
    expect(
      groundRefusalFromDocument({
        platform: "x",
        status: 200,
        finalUrl: "https://x.com/example",
        body,
      }),
    ).toBeNull();
  });

  it("refuses an unlisted YouTube channel", () => {
    expect(
      groundRefusalFromDocument({
        platform: "youtube",
        status: 200,
        finalUrl: "https://www.youtube.com/@example",
        body: '{"unlisted":true,"familySafe":true}',
      }),
    ).toBe("private");
  });

  it("refuses HTTP 401 as a login wall before any flag", () => {
    expect(instagram('{"is_private":false}', 401)).toBe("login");
  });

  it("refuses a login URL when the page has no profile flag", () => {
    expect(instagram("<html>sign in</html>", 200, "https://www.instagram.com/accounts/login")).toBe("login");
  });

  it("does not treat a readable public profile as a login wall", () => {
    expect(instagram('{"is_private":false}', 200, "https://www.instagram.com/accounts/login")).toBeNull();
  });

  it("does not treat HTTP 403 as a login wall", () => {
    expect(instagram("", 403, "https://www.instagram.com/example/")).toBeNull();
  });
});

describe("readSubjectGroundTruth", () => {
  it("does not fetch a domain", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const subject: Subject = { kind: "domain", registrable: "gymshark.com", url: "https://gymshark.com/" };
    await expect(readSubjectGroundTruth(subject)).resolves.toEqual({ refusal: null, fetched: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not fetch a bare handle", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const subject: Subject = { kind: "handle", registrable: "someone", url: null };
    await expect(readSubjectGroundTruth(subject)).resolves.toEqual({ refusal: null, fetched: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads a platform flag and does not keep the page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"is_private":true}', { status: 200 }));
    const subject: Subject = {
      kind: "handle",
      platform: "instagram",
      registrable: "example",
      url: "https://www.instagram.com/example/",
    };
    await expect(readSubjectGroundTruth(subject)).resolves.toEqual({ refusal: "private", fetched: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
