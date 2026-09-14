import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  classifyProbeResponse,
  coverageVerdict,
  probeAdvertisedUrls,
  servesNoindex,
  urlsFromLlmsTxt,
  urlsFromSitemapXml,
} from "../scripts/canary-sitemap-coverage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "canary-sitemap-coverage.mjs");

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://0509.io/</loc></url>
  <url><loc>https://0509.io/search</loc></url>
  <url><loc>/guides/how-to-track-competitor-ads</loc></url>
  <url><loc>https://0509.io/switch/adspy</loc></url>
  <url><loc>https://0509.io/llms-full.txt</loc></url>
</urlset>`;

const LLMS = `# Five to Nine

Pages:
- [Five to Nine](https://0509.io/): home.
- [Public search](https://0509.io/search): live search.
- [Docs](https://docs.example.com/x): off-origin, never probed.
- bare mention https://0509.io/pricing and a fragment https://0509.io/brands#top
`;

function writeFixture(name: string, body: string) {
  const dir = mkdtempSync(join(tmpdir(), "sm-coverage-"));
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

describe("canary-sitemap-coverage — sitemap parsing", () => {
  it("collects absolute and relative <loc> entries resolved against the base", () => {
    const urls = urlsFromSitemapXml(SITEMAP);
    expect(urls).toEqual([
      "https://0509.io/",
      "https://0509.io/guides/how-to-track-competitor-ads",
      "https://0509.io/llms-full.txt",
      "https://0509.io/search",
      "https://0509.io/switch/adspy",
    ]);
  });

  it("strips fragments and dedupes", () => {
    const urls = urlsFromSitemapXml(
      `<url><loc>https://0509.io/a#x</loc></url><url><loc>https://0509.io/a</loc></url>`,
    );
    expect(urls).toEqual(["https://0509.io/a"]);
  });

  it("keeps a trailing slash significant (no /foo vs /foo/ collapse)", () => {
    const urls = urlsFromSitemapXml(
      `<url><loc>https://0509.io/foo/</loc></url><url><loc>https://0509.io/foo</loc></url>`,
    );
    expect(urls).toEqual(["https://0509.io/foo", "https://0509.io/foo/"]);
  });
});

describe("canary-sitemap-coverage — llms.txt parsing", () => {
  it("collects same-origin links only, from markdown links and bare mentions", () => {
    const urls = urlsFromLlmsTxt(LLMS);
    expect(urls).toEqual([
      "https://0509.io/",
      "https://0509.io/brands",
      "https://0509.io/pricing",
      "https://0509.io/search",
    ]);
  });
});

describe("canary-sitemap-coverage — noindex detection", () => {
  const noHeaders = { get: () => null };

  it("matches the real robots meta tag, not the bare word", () => {
    const loaderJson = '{"state":"noindex handling noted"}';
    expect(servesNoindex(`<html><body>${loaderJson}</body></html>`, noHeaders)).toBe(false);
    expect(
      servesNoindex(
        '<html><head><meta name="robots" content="noindex"></head></html>',
        noHeaders,
      ),
    ).toBe(true);
    expect(
      servesNoindex(
        '<html><head><meta content="noindex, follow" name="robots"></head></html>',
        noHeaders,
      ),
    ).toBe(true);
  });

  it("matches an X-Robots-Tag: noindex response header", () => {
    expect(
      servesNoindex("<html><body>ok</body></html>", {
        get: (name: string) =>
          name.toLowerCase() === "x-robots-tag" ? "noindex" : null,
      }),
    ).toBe(true);
  });
});

describe("canary-sitemap-coverage — response classification", () => {
  const htmlHeaders = { get: (n: string) => (n === "content-type" ? "text/html; charset=utf-8" : null) };

  it("200 + HTML body + indexable is ok", () => {
    expect(
      classifyProbeResponse({ status: 200, headers: htmlHeaders, body: "<html>ok</html>" }).ok,
    ).toBe(true);
  });

  it("any non-200 (404, 301, 500) is a divergence — redirects are not followed", () => {
    for (const status of [301, 404, 500]) {
      const v = classifyProbeResponse({ status, headers: htmlHeaders, body: "" });
      expect(v.ok).toBe(false);
      expect(v.reason).toBe(`http-${status}`);
    }
  });

  it("a 200 with an empty or markup-less HTML body diverges as empty-body", () => {
    expect(
      classifyProbeResponse({ status: 200, headers: htmlHeaders, body: "   " }).reason,
    ).toBe("empty-body");
    expect(
      classifyProbeResponse({ status: 200, headers: htmlHeaders, body: "not html" }).reason,
    ).toBe("empty-body");
  });

  it("a non-HTML advertised doc (llms-full.txt) needs only 200 + non-empty", () => {
    const textHeaders = { get: (n: string) => (n === "content-type" ? "text/plain; charset=utf-8" : null) };
    expect(
      classifyProbeResponse({ status: 200, headers: textHeaders, body: "# feed\nline" }).ok,
    ).toBe(true);
    expect(
      classifyProbeResponse({ status: 200, headers: textHeaders, body: "" }).reason,
    ).toBe("empty-body");
  });

  it("200 HTML carrying the noindex tag diverges as noindex", () => {
    const v = classifyProbeResponse({
      status: 200,
      headers: htmlHeaders,
      body: '<html><head><meta name="robots" content="noindex"></head><body>x</body></html>',
    });
    expect(v.reason).toBe("noindex");
  });
});

describe("canary-sitemap-coverage — probe pool", () => {
  it("collects per-URL verdicts through the concurrency pool", async () => {
    const fetchImpl = async (url: string) =>
      ({
        status: url.endsWith("/dead") ? 404 : 200,
        headers: { get: () => "text/html" },
        text: async () => "<html>ok</html>",
      }) as unknown as Response;
    const results = await probeAdvertisedUrls(
      ["https://x.test/a", "https://x.test/dead", "https://x.test/b"],
      { fetchImpl: fetchImpl as typeof fetch, delayMs: 0 },
    );
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1].reason).toBe("http-404");
  });

  it("retries a transient 429 once, then reports the last status", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        status: calls === 1 ? 429 : 200,
        headers: { get: () => "text/html" },
        text: async () => "<html>ok</html>",
      } as unknown as Response;
    };
    const [result] = await probeAdvertisedUrls(["https://x.test/a"], {
      fetchImpl: fetchImpl as typeof fetch,
      delayMs: 0,
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("a network throw after retry is a fetch-error divergence, not a crash", async () => {
    const fetchImpl = async () => {
      throw new Error("socket hangup");
    };
    const [result] = await probeAdvertisedUrls(["https://x.test/a"], {
      fetchImpl: fetchImpl as typeof fetch,
      delayMs: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("fetch-error");
  });
});

describe("canary-sitemap-coverage — verdict", () => {
  it("passes only when every advertised URL probed ok", () => {
    const pass = coverageVerdict([
      { url: "a", ok: true, status: 200, reason: "ok", detail: "" },
    ]);
    expect(pass.verdict).toBe("pass");
    const fail = coverageVerdict([
      { url: "a", ok: true, status: 200, reason: "ok", detail: "" },
      { url: "b", ok: false, status: 404, reason: "http-404", detail: "HTTP 404" },
    ]);
    expect(fail.verdict).toBe("fail");
    expect(fail.divergences).toEqual([
      { url: "b", status: 404, reason: "http-404", detail: "HTTP 404" },
    ]);
  });
});

/**
 * The CLI tests spawnSync the script — which freezes this process's event
 * loop — so the stub site has to live in its OWN node process. The stub
 * prints its bound port on stdout once listening.
 */
const STUB_SOURCE = `
const { createServer } = require("node:http");
const sitemap = ${JSON.stringify(SITEMAP)};
const llms = ${JSON.stringify(LLMS)};
const server = createServer((req, res) => {
  const self = "http://" + req.headers.host;
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path === "/sitemap.xml") {
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(sitemap.replaceAll("https://0509.io", self));
    return;
  }
  if (path === "/llms.txt") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(llms.replaceAll("https://0509.io", self));
    return;
  }
  if (path === "/dead") {
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<html>not found</html>");
    return;
  }
  if (path === "/noindex-page") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<html><head><meta name="robots" content="noindex"></head><body>x</body></html>');
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body>ok</body></html>");
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("PORT=" + server.address().port + "\\n");
});
`;

const DIVERGED_STUB_SOURCE = `
const { createServer } = require("node:http");
const server = createServer((req, res) => {
  const self = "http://" + req.headers.host;
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path === "/sitemap.xml") {
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(
      "<url><loc>" + self + "/</loc></url><url><loc>" + self + "/dead</loc></url>",
    );
    return;
  }
  if (path === "/llms.txt") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("# stub\\n");
    return;
  }
  if (path === "/dead") {
    res.writeHead(404).end("gone");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body>ok</body></html>");
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("PORT=" + server.address().port + "\\n");
});
`;

async function startStub(source: string): Promise<{ child: ChildProcess; base: string }> {
  const child = spawn(process.execPath, ["-e", source], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const base = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("stub did not bind")), 5000);
    child.stdout!.on("data", (chunk) => {
      buf += String(chunk);
      const match = buf.match(/PORT=(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    child.on("exit", () => reject(new Error(`stub exited early: ${buf}`)));
  });
  return { child, base };
}

async function stopStub(child: ChildProcess) {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

describe("canary-sitemap-coverage — CLI exit codes (local stub)", () => {
  let stub: ChildProcess;
  let base: string;

  beforeAll(async () => {
    ({ child: stub, base } = await startStub(STUB_SOURCE));
  }, 15000);

  afterAll(async () => {
    await stopStub(stub);
  });

  it("passes (exit 0) when every advertised URL serves indexable 200", () => {
    const result = spawnSync(
      process.execPath,
      [script, "--base", base, "--delay-ms", "0", "--json"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.advertised).toBeGreaterThan(5);
    expect(report.divergences).toEqual([]);
  });

  it("fails (exit 1) naming each divergent URL — the incident's 404 class", () => {
    const xml =
      `<url><loc>${base}/</loc></url>` +
      `<url><loc>${base}/dead</loc></url>` +
      `<url><loc>${base}/noindex-page</loc></url>`;
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--base", base,
        "--input", writeFixture("sitemap.xml", xml),
        "--delay-ms", "0",
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`${base}/dead — http-404`);
    expect(result.stdout).toContain(`${base}/noindex-page — noindex`);
  });

  it("exits 2 when the sitemap itself cannot be fetched", () => {
    const result = spawnSync(
      process.execPath,
      [script, "--base", `${base}/`, "--input", join(tmpdir(), `missing-${Date.now()}.xml`)],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
  });

  // Fixture-poisoning guard (M56 pattern): pure fixture input must never
  // reach the issue-filing path, even with --file-issue.
  it("does not fire the filing path on fixture input", () => {
    const xml = `<url><loc>${base}/dead</loc></url>`;
    const result = spawnSync(
      process.execPath,
      [script, "--base", base, "--input", writeFixture("sitemap.xml", xml), "--file-issue", "--dry-run", "--delay-ms", "0"],
      { encoding: "utf8" },
    );
    expect(result.stdout).not.toContain("would run: gh issue create");
    expect(result.stdout).not.toContain("auto-filed");
    expect(result.status).toBe(1);
  });

  it("live mode --file-issue --dry-run prints the would-file line on divergence", async () => {
    // A second stub whose sitemap advertises a 404 — the incident's class —
    // exercises the real live fetch + probe + filing path end to end.
    const { child, base: divergedBase } = await startStub(DIVERGED_STUB_SOURCE);
    try {
      const result = spawnSync(
        process.execPath,
        [script, "--base", divergedBase, "--file-issue", "--dry-run", "--delay-ms", "0"],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`${divergedBase}/dead — http-404`);
      expect(result.stdout).toContain("[dry-run] would run: gh issue create");
    } finally {
      await stopStub(child);
    }
  }, 20000);
});
