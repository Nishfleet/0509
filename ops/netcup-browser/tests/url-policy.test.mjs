// Focused tests for the per-kind URL policy (SSRF IPv4/IPv6, redirect
// revalidation, Meta Ad Library allowlist, PDF token shape).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateMetaUrl,
  validateLandingTarget,
  validatePdfToken,
  buildShareUrl,
  followRedirects,
  isBlockedIp,
  isBlockedIpv4,
  isBlockedIpv6,
  UrlPolicyError,
} from "../src/url-policy.mjs";

// --- blocked IP literals -----------------------------------------------------

test("IPv4 blocked ranges: loopback, RFC1918, link-local, metadata, multicast", () => {
  for (const ip of [
    "127.0.0.1", "127.255.255.255",
    "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.255",
    "192.168.0.1", "192.168.255.255",
    "169.254.169.254", "169.254.0.1",
    "0.0.0.0", "0.1.2.3",
    "100.64.0.1", "100.127.255.255",
    "224.0.0.1", "239.255.255.255", "240.0.0.1",
  ]) {
    assert.equal(isBlockedIpv4(ip), true, `expected ${ip} blocked`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1"]) {
    assert.equal(isBlockedIpv4(ip), false, `expected ${ip} allowed`);
  }
});

test("IPv6 blocked ranges: loopback, ULA, link-local, mapped IPv4, NAT64", () => {
  for (const ip of [
    "::1", "::",
    "fc00::1", "fd00::1", "fdf8:f53b:82e4::53",
    "fe80::1", "fe80::abcd",
    "ff00::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:192.168.1.1",
    "64:ff9b::127.0.0.1", "64:ff9b::10.0.0.1",
    "2002:7f00:1::", // 6to4 with 127.0.0.1 embedded — blocked entirely
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo — blocked entirely
  ]) {
    assert.equal(isBlockedIpv6(ip), true, `expected ${ip} blocked`);
  }
  for (const ip of [
    "2606:4700:4700::1111", // Cloudflare DNS
    "2001:4860:4860::8888", // Google DNS
    "::ffff:8.8.8.8", // mapped PUBLIC ipv4 — allowed
    "64:ff9b::8.8.8.8", // NAT64 public — allowed
  ]) {
    assert.equal(isBlockedIpv6(ip), false, `expected ${ip} allowed`);
  }
});

test("isBlockedIp dispatches both families", () => {
  assert.equal(isBlockedIp("10.0.0.1"), true);
  assert.equal(isBlockedIp("::ffff:10.0.0.1"), true);
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("2606:4700::1"), false);
});

// --- landing policy -----------------------------------------------------------

const stubLookup = (map) => async (host) => map[host] ?? [];

test("validateLandingTarget: rejects credentials, odd ports, blocked literals", async () => {
  await assert.rejects(
    validateLandingTarget("https://user:pass@example.com/", { lookup: stubLookup({}) }),
    (e) => e.code === "url_credentials",
  );
  await assert.rejects(
    validateLandingTarget("https://example.com:8443/", { lookup: stubLookup({}) }),
    (e) => e.code === "port_not_allowed",
  );
  await assert.rejects(
    validateLandingTarget("ftp://example.com/", { lookup: stubLookup({}) }),
    (e) => e.code === "scheme_not_allowed",
  );
  await assert.rejects(
    validateLandingTarget("https://127.0.0.1/x", { lookup: stubLookup({}) }),
    (e) => e.code === "private_ip",
  );
  await assert.rejects(
    validateLandingTarget("http://[::1]/x", { lookup: stubLookup({}) }),
    (e) => e.code === "private_ip",
  );
});

test("validateLandingTarget: rejects host whose DNS resolves to a private IP (rebinding)", async () => {
  const lookup = stubLookup({ "evil.example": ["8.8.8.8", "127.0.0.1"] });
  await assert.rejects(
    validateLandingTarget("https://evil.example/", { lookup }),
    (e) => e.code === "private_ip" && /127\.0\.0\.1/.test(e.message),
  );
  const lookup6 = stubLookup({ "v6.example": ["2001:4860:4860::8888", "::1"] });
  await assert.rejects(
    validateLandingTarget("https://v6.example/", { lookup: lookup6 }),
    (e) => e.code === "private_ip" && /::1/.test(e.message),
  );
});

test("validateLandingTarget: allows public http/https", async () => {
  const lookup = stubLookup({ "example.com": ["93.184.216.34"], "1.1.1.1": ["1.1.1.1"] });
  const url = await validateLandingTarget("https://example.com/path", { lookup });
  assert.equal(url.hostname, "example.com");
  await assert.rejects(
    validateLandingTarget("http://1.1.1.1/x", { lookup: stubLookup({}) }),
    (e) => e.code === "dns_failed", // literal not resolvable via lookup stub
  );
});

test("followRedirects: re-validates every hop and caps at 5", async () => {
  let calls = 0;
  const chain = {
    "https://a.example/": "https://b.example/",
    "https://b.example/": "https://c.example/",
    "https://c.example/": "https://c.example/final",
  };
  const fetchImpl = async (url) => {
    calls++;
    const next = chain[url];
    return new Response(next ? null : "<html>final</html>", {
      status: next ? 302 : 200,
      headers: next ? { location: next } : { "content-type": "text/html" },
    });
  };
  const lookup = stubLookup({
    "a.example": ["8.8.8.8"],
    "b.example": ["8.8.8.8"],
    "c.example": ["8.8.8.8"],
  });
  const result = await followRedirects("https://a.example/", { fetchImpl, lookup });
  assert.equal(result.redirects, 3);
  assert.equal(result.status, 200);
  assert.equal(result.url.hostname, "c.example");

  // Redirect to a private host must fail even if the FIRST hop was public.
  const evilFetch = async (url) => {
    if (url === "https://a.example/") {
      return new Response(null, { status: 302, headers: { location: "http://192.168.1.1/x" } });
    }
    return new Response(null, { status: 200 });
  };
  await assert.rejects(
    followRedirects("https://a.example/", { fetchImpl: evilFetch, lookup }),
    (e) => e.code === "private_ip",
  );
});

test("followRedirects: more than 5 redirects fails", async () => {
  const fetchImpl = async (url) => {
    const n = Number(new URL(url).pathname.slice(1));
    return new Response(null, { status: 302, headers: { location: `https://a.example/${n + 1}` } });
  };
  const lookup = stubLookup({ "a.example": ["8.8.8.8"] });
  await assert.rejects(
    followRedirects("https://a.example/0", { fetchImpl, lookup }),
    (e) => e.code === "too_many_redirects",
  );
});

// --- meta policy ---------------------------------------------------------------

test("validateMetaUrl: allowlisted host/path/query only", () => {
  const ok = validateMetaUrl("https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&q=hello&id=12345");
  assert.equal(ok.hostname, "www.facebook.com");

  for (const bad of [
    "https://evil.com/ads/library/?id=1",
    "http://www.facebook.com/ads/library/?id=1",
    "https://www.facebook.com/other/path",
    "https://www.facebook.com/ads/library/?evil=1",
    "https://www.facebook.com/ads/library/?country=india",
    "https://www.facebook.com/ads/library/?view_all_page_id=abc",
    "https://www.facebook.com/ads/library/?q=" + "x".repeat(600),
    "https://facebook.com.evil.example/ads/library/",
    "https://www.facebook.com/ads/library/?id=1&next=https://evil.com",
  ]) {
    assert.throws(() => validateMetaUrl(bad), UrlPolicyError, `expected rejection: ${bad}`);
  }
});

// --- pdf policy ----------------------------------------------------------------

test("validatePdfToken: only the 0509 32-char hex share token shape", () => {
  assert.equal(validatePdfToken("a1b2c3d4e5f60718293a4b5c6d7e8f90"), "a1b2c3d4e5f60718293a4b5c6d7e8f90");
  assert.equal(validatePdfToken("A1B2C3D4E5F60718293A4B5C6D7E8F90"), "a1b2c3d4e5f60718293a4b5c6d7e8f90");
  for (const bad of ["short", "z".repeat(32), "a1b2c3d4e5f60718293a4b5c6d7e8f9", "a1b2c3d4e5f60718293a4b5c6d7e8f901", "https://evil.com/x", ""]) {
    assert.throws(() => validatePdfToken(bad), UrlPolicyError, `expected rejection: ${bad}`);
  }
});

test("buildShareUrl: reconstructs the same-origin 0509 share URL with ?pdf=1", () => {
  const url = buildShareUrl("a1b2c3d4e5f60718293a4b5c6d7e8f90", "https://0509.io");
  assert.equal(url.toString(), "https://0509.io/share/a1b2c3d4e5f60718293a4b5c6d7e8f90?pdf=1");
});
