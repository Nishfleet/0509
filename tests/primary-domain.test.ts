import { describe, expect, it } from "vitest";

import { primaryDomainRedirect } from "../workers/primary-domain";

describe("primary domain redirects", () => {
  it("redirects safe legacy apex requests to the global primary domain", () => {
    const response = primaryDomainRedirect(
      new Request("https://0509.in/search?query=nykaa", { method: "GET" }),
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("https://0509.io/search?query=nykaa");
    expect(response?.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("normalizes www on both old and new domains", () => {
    expect(
      primaryDomainRedirect(new Request("https://www.0509.in/app/watchlists"))?.headers.get("location"),
    ).toBe("https://0509.io/app/watchlists");
    expect(
      primaryDomainRedirect(new Request("https://www.0509.io/privacy"))?.headers.get("location"),
    ).toBe("https://0509.io/privacy");
  });

  it("redirects safe legacy API hostname requests to the global API hostname", () => {
    const response = primaryDomainRedirect(
      new Request("https://api.0509.in/api/health?probe=1", { method: "HEAD" }),
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe(
      "https://api.0509.io/api/health?probe=1",
    );
    expect(primaryDomainRedirect(new Request("https://api.0509.io/api/health"))).toBeNull();
  });

  it("lets legacy API POST callbacks reach their signed handlers", () => {
    expect(
      primaryDomainRedirect(
        new Request("https://api.0509.in/api/webhooks/dodo?event=evt_123", { method: "POST" }),
      ),
    ).toBeNull();
    expect(
      primaryDomainRedirect(
        new Request("https://0509.in/api/webhooks/razorpay", { method: "POST" }),
      ),
    ).toBeNull();
  });

  it("lets legacy provider GET challenges reach their verification routes", () => {
    expect(
      primaryDomainRedirect(
        new Request(
          "https://0509.in/api/delivery-status/whatsapp?hub.mode=subscribe&hub.challenge=ok",
        ),
      ),
    ).toBeNull();
    expect(
      primaryDomainRedirect(
        new Request(
          "https://api.0509.in/api/delivery-status/whatsapp?hub.mode=subscribe&hub.challenge=ok",
        ),
      ),
    ).toBeNull();
  });
});
