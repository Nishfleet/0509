import { describe, expect, it } from "vitest";

import { allowedRedirectUri } from "../../app/lib/agent/redirect-uri";

describe("allowedRedirectUri", () => {
  it("accepts https and loopback http", () => {
    expect(allowedRedirectUri("https://app.example/callback")).toBe(true);
    expect(allowedRedirectUri("http://localhost:8787/cb")).toBe(true);
    expect(allowedRedirectUri("http://127.0.0.1/cb")).toBe(true);
    expect(allowedRedirectUri("http://[::1]/cb")).toBe(true);
    expect(allowedRedirectUri("http://127.0.0.8/cb")).toBe(true);
  });

  it("accepts custom app schemes with a host or path", () => {
    expect(allowedRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
    expect(allowedRedirectUri("vscode://vscode.github-authentication/did-authenticate")).toBe(true);
    expect(allowedRedirectUri("com.example.app:/oauth2redirect")).toBe(true);
  });

  it("rejects dangerous and empty custom schemes", () => {
    for (const uri of [
      "javascript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "file:///etc/passwd",
      "blob:https://a.example/id",
      "about:blank",
      "ftp://a.example/x",
      "ws://a.example/x",
      "wss://a.example/x",
      "chrome://settings",
      "chrome-extension://abc/cb",
      "cursor:",
      "cursor://",
    ]) {
      expect(allowedRedirectUri(uri), uri).toBe(false);
    }
  });

  it("rejects remote http and garbage", () => {
    expect(allowedRedirectUri("http://evil.example/callback")).toBe(false);
    expect(allowedRedirectUri("not a uri")).toBe(false);
  });
});
