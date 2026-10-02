import { describe, expect, it } from "vitest";

import {
  type AlertFooterContext,
  renderAlertFooter,
  SETTINGS_LINK,
  unsubscribeHeaders,
} from "../../workers/delivery/alert-footer";

const UNSUBSCRIBE_URL = "https://0509.io/u/token?w=ws_1&t=abc";
const HOSTILE_URL = 'https://0509.io/u/token?w=ws_1&t=abc"def';
const CTX: AlertFooterContext = {
  unsubscribe_url: UNSUBSCRIBE_URL,
  settings_link: SETTINGS_LINK,
};

describe("the alert email's one-click unsubscribe headers (0509#6511)", () => {
  it("names the exact header pair mail clients read for one click", () => {
    expect(unsubscribeHeaders(UNSUBSCRIBE_URL)).toEqual({
      "List-Unsubscribe": `<${UNSUBSCRIBE_URL}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("the alert email's footer html (0509#6511)", () => {
  it("links the settings page at the address customers can read", () => {
    expect(renderAlertFooter(CTX).html).toContain('href="https://0509.io/app/settings"');
  });

  it("escapes a URL that carries an ampersand and a quote, and never leaks either raw into an href", () => {
    const { html } = renderAlertFooter({ ...CTX, unsubscribe_url: HOSTILE_URL });
    expect(html).toContain('href="https://0509.io/u/token?w=ws_1&amp;t=abc&quot;def"');
    expect(html).not.toContain('href="https://0509.io/u/token?w=ws_1&t=abc"def"');
  });
});

describe("the alert email's footer text (0509#6511)", () => {
  it("spells out both raw URLs on their own lines", () => {
    expect(renderAlertFooter(CTX).text).toBe(
      `Choose which alerts you get in Settings: ${SETTINGS_LINK}\nUnsubscribe: ${UNSUBSCRIBE_URL}`,
    );
  });
});
