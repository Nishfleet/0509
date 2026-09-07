const CONNECT_TIMEOUT_MS = 20_000;
const COMMAND_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 500;

/**
 * @typedef {{
 *   hasSelector: boolean,
 *   readyState: string,
 *   loginWall: boolean,
 *   rateLimited: boolean,
 *   blockedLikely: boolean
 * }} CdpPageState
 */

/**
 * @typedef {{
 *   html: string,
 *   pageState: CdpPageState
 * }} CdpExtractionResult
 */

/**
 * @typedef {{
 *   width: number,
 *   height: number,
 *   deviceScaleFactor: number,
 *   mobile: boolean
 * }} CdpViewport
 */

/**
 * @typedef {(url: string) => WebSocket} WebSocketFactory
 */

/**
 * @param {string | Blob | ArrayBufferLike | ArrayBufferView} data
 */
async function normalizeMessageData(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Blob) {
    return await data.text();
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return String(data);
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class MinimalCdpClient {
  /**
   * @param {string} wsUrl
   * @param {{ webSocketFactory?: WebSocketFactory }} [options]
   */
  constructor(wsUrl, options = {}) {
    this.wsUrl = wsUrl;
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    /** @type {Map<number, { resolve: (value: any) => void, reject: (reason?: unknown) => void, timeout: ReturnType<typeof setTimeout> }>} */
    this.pending = new Map();
    this.socket = null;
    this.nextId = 0;
  }

  async connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    this.socket = this.webSocketFactory(this.wsUrl);
    const socket = this.socket;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out connecting to ${this.wsUrl}`));
      }, CONNECT_TIMEOUT_MS);

      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve(undefined);
      }, { once: true });

      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error(`Failed to connect to ${this.wsUrl}`));
      }, { once: true });
    });

    socket.addEventListener("message", async (event) => {
      const text = await normalizeMessageData(event.data);
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return;
      }

      if (!payload || typeof payload.id !== "number") {
        return;
      }

      const pending = this.pending.get(payload.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pending.delete(payload.id);

      if (payload.error) {
        pending.reject(new Error(payload.error.message || `CDP error for ${payload.id}`));
        return;
      }

      pending.resolve(payload.result ?? {});
    });

    socket.addEventListener("close", () => {
      const error = new Error("CDP socket closed.");
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @param {string | undefined} [sessionId]
   */
  async send(method, params = {}, sessionId) {
    await this.connect();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("CDP socket is not open.");
    }

    const id = ++this.nextId;
    const payload = {
      id,
      method,
      params,
      ...(sessionId ? { sessionId } : {}),
    };

    return await new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket) {
        reject(new Error("CDP socket is not initialized."));
        return;
      }
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP response to ${method}`));
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(id, {
        resolve,
        reject,
        timeout,
      });

      socket.send(JSON.stringify(payload));
    });
  }

  async close() {
    if (!this.socket) {
      return;
    }

    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
      await sleep(20);
    }
  }
}

/**
 * @param {MinimalCdpClient} client
 * @param {string} sessionId
 * @param {string} selector
 * @param {number} timeoutMs
 * @returns {Promise<CdpPageState>}
 */
async function waitForPageState(client, sessionId, selector, timeoutMs) {
  const startedAt = Date.now();
  const expression = `
    (() => {
      const bodyText = (document.body?.innerText ?? "").toLowerCase();
      return {
        hasSelector: Boolean(document.querySelector(${JSON.stringify(selector)})),
        readyState: document.readyState,
        loginWall: /log in|login|sign in|sign into/.test(bodyText) && bodyText.includes("facebook"),
        rateLimited: bodyText.includes("rate limit") || bodyText.includes("too many requests") || bodyText.includes("try again later"),
        blockedLikely: bodyText.includes("captcha") || bodyText.includes("access denied") || bodyText.includes("temporarily blocked") || bodyText.includes("unusual activity"),
      };
    })()
  `;

  while (Date.now() - startedAt < timeoutMs) {
    const evaluation = await client.send(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
      },
      sessionId,
    );
    const value = evaluation?.result?.value;
    if (value?.hasSelector || value?.loginWall || value?.rateLimited || value?.blockedLikely) {
      return value;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const finalEvaluation = await client.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
    },
    sessionId,
  );
  return finalEvaluation?.result?.value ?? {
    hasSelector: false,
    readyState: "unknown",
    loginWall: false,
    rateLimited: false,
    blockedLikely: false,
  };
}

/**
 * @param {{
 *   wsUrl: string,
 *   url: string,
 *   selector: string,
 *   userAgent: string,
 *   viewport: CdpViewport,
 *   webSocketFactory?: WebSocketFactory,
 *   timeoutMs?: number
 * }} options
 * @returns {Promise<CdpExtractionResult>}
 */
export async function extractHtmlViaCdp(options) {
  const client = new MinimalCdpClient(options.wsUrl, {
    webSocketFactory: options.webSocketFactory,
  });
  let targetId;

  try {
    const createTarget = await client.send("Target.createTarget", {
      url: "about:blank",
    });
    targetId = createTarget?.targetId;

    const attached = await client.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sessionId = attached?.sessionId;

    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Emulation.setUserAgentOverride", {
      userAgent: options.userAgent,
      acceptLanguage: "en-US,en;q=0.9",
      platform: "iPhone",
    }, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: options.viewport.width,
      height: options.viewport.height,
      deviceScaleFactor: options.viewport.deviceScaleFactor,
      mobile: options.viewport.mobile,
      screenWidth: options.viewport.width,
      screenHeight: options.viewport.height,
      positionX: 0,
      positionY: 0,
    }, sessionId);
    await client.send("Page.navigate", {
      url: options.url,
    }, sessionId);

    const pageState = await waitForPageState(
      client,
      sessionId,
      options.selector,
      options.timeoutMs ?? 8_000,
    );
    const htmlResult = await client.send(
      "Runtime.evaluate",
      {
        expression: "document.documentElement.outerHTML",
        returnByValue: true,
      },
      sessionId,
    );

    return {
      html: htmlResult?.result?.value ?? "",
      pageState,
    };
  } finally {
    if (targetId) {
      await client.send("Target.closeTarget", { targetId }).catch(() => undefined);
    }
    await client.close().catch(() => undefined);
  }
}
