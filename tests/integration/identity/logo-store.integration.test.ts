import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readLogo, storeLogo } from "../../../app/lib/identity/logo-store.server";

const PNG_BYTES = new Uint8Array([1, 2, 3]);

function png(): Response {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

function logoKeys(): Promise<string[]> {
  return env.SNAPSHOTS.list({ prefix: "logo/" }).then((listed) => listed.objects.map((object) => object.key));
}

async function clearLogoPrefix(): Promise<void> {
  const listed = await env.SNAPSHOTS.list({ prefix: "logo/" });
  await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));
}

describe("storeLogo and readLogo", () => {
  beforeEach(async () => {
    await clearLogoPrefix();
    expect(await logoKeys()).toEqual([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores a served png at logo/<registrable> and reads back the same bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => png()));

    const stored = await storeLogo("gymshark.com", "https://gymshark.com/logo.png");

    expect(stored).toEqual({ contentType: "image/png", bytes: PNG_BYTES });
    const object = await readLogo("gymshark.com");
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe("image/png");
    expect(await object?.arrayBuffer()).toEqual(PNG_BYTES.buffer);
  });

  it("never fetches a URL that is not public https", async () => {
    const fetchSpy = vi.fn(async () => png());
    vi.stubGlobal("fetch", fetchSpy);

    for (const url of ["http://a.test/x.png", "https://127.0.0.1/x.png", "https://localhost/x.png"]) {
      expect(await storeLogo("a.test", url)).toBeNull();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await logoKeys()).toEqual([]);
  });

  it("returns null and stores nothing when the served type is not an image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })));

    expect(await storeLogo("gymshark.com", "https://gymshark.com/")).toBeNull();
    expect(await readLogo("gymshark.com")).toBeNull();
    expect(await logoKeys()).toEqual([]);
  });

  it("returns null when the served type is an svg", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<svg/>", {
      status: 200,
      headers: { "content-type": "image/svg+xml" },
    })));

    expect(await storeLogo("gymshark.com", "https://gymshark.com/logo.svg")).toBeNull();
    expect(await readLogo("gymshark.com")).toBeNull();
    expect(await logoKeys()).toEqual([]);
  });

  it("returns null from the declared length alone when the body itself is under the cap", async () => {
    const underCap = (): ReadableStream<Uint8Array> =>
      new ReadableStream({
        pull(controller) {
          controller.enqueue(PNG_BYTES);
          controller.close();
        },
      });
    const declared = new Response(underCap(), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "2000000" },
    });
    expect(declared.headers.get("content-length")).toBe("2000000");
    vi.stubGlobal("fetch", vi.fn(async () => declared));

    expect(await storeLogo("gymshark.com", "https://gymshark.com/big.png")).toBeNull();
    expect(await logoKeys()).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(underCap(), {
      status: 200,
      headers: { "content-type": "image/png" },
    })));

    expect(await storeLogo("gymshark.com", "https://gymshark.com/small.png"))
      .toEqual({ contentType: "image/png", bytes: PNG_BYTES });
  });

  it("stops a streamed body once it passes the cap", async () => {
    const overCap = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(600_000));
        controller.enqueue(new Uint8Array(600_000));
        controller.close();
      },
    });
    const streaming = new Response(overCap, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    expect(streaming.headers.get("content-length")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => streaming));

    expect(await storeLogo("gymshark.com", "https://gymshark.com/endless.png")).toBeNull();
    expect(await readLogo("gymshark.com")).toBeNull();
    expect(await logoKeys()).toEqual([]);
  });

  it("returns null when a followed redirect lands on a host that is not public https", async () => {
    const redirected = png();
    Object.defineProperty(redirected, "url", { value: "https://127.0.0.1/logo.png", configurable: true });
    vi.stubGlobal("fetch", vi.fn(async () => redirected));

    expect(await storeLogo("gymshark.com", "https://gymshark.com/logo.png")).toBeNull();
    expect(await readLogo("gymshark.com")).toBeNull();
    expect(await logoKeys()).toEqual([]);
  });

  it("returns null on a 404 and stores nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", {
      status: 404,
      headers: { "content-type": "image/png" },
    })));

    expect(await storeLogo("gymshark.com", "https://gymshark.com/missing.png")).toBeNull();
    expect(await readLogo("gymshark.com")).toBeNull();
    expect(await logoKeys()).toEqual([]);
  });
});
