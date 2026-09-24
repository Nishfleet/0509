import robotsParser from "robots-parser";

const ROBOTS_TIMEOUT_MS = 5_000;

const ROBOTS_AGENT = "FiveToNineBot";

const ROBOTS_HEADERS = { "user-agent": "FiveToNineBot/1.0 (+https://0509.io)" };

export async function robotsAllows(url: string): Promise<boolean> {
  const robotsUrl = new URL("/robots.txt", url).toString();
  try {
    const response = await fetch(robotsUrl, {
      headers: ROBOTS_HEADERS,
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return true;
    }
    const body = await response.text();
    return robotsParser(robotsUrl, body).isDisallowed(url, ROBOTS_AGENT) !== true;
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "robots.read_failed",
        url: robotsUrl,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return true;
  }
}
