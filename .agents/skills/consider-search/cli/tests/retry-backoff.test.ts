import { afterEach, describe, expect, test } from "bun:test";
import { fetchSession, BoardNotFoundError } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry loop offline: a
// stubbed fetch counts attempts, and a stubbed setTimeout fires immediately so the exhaustion
// case does not sleep through the real 500ms -> 8s backoff schedule.

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function instantTimers() {
  globalThis.setTimeout = ((fn: () => void) =>
    originalSetTimeout(fn, 0)) as unknown as typeof setTimeout;
}

function stubFetch(responses: Array<() => Response>): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    const i = Math.min(state.calls, responses.length - 1);
    state.calls++;
    return responses[i]();
  }) as unknown as typeof fetch;
  return state;
}

const OK_SESSION_HTML =
  '<html><script>window.serverInitialData = {"csrfToken":"tok","board":{"id":"foresite-capital"}};</script></html>';

describe("fetchSession retry/backoff (the GET that mints every command's session)", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response(OK_SESSION_HTML, { status: 200 }),
    ]);

    const session = await fetchSession("careers.foresitecapital.com");
    expect(session.csrfToken).toBe("tok");
    expect(state.calls).toBe(2);
  });

  test("a 404 board throws BoardNotFoundError without retrying (documented contract, not a crash)", async () => {
    const state = stubFetch([() => new Response("", { status: 404 })]);

    await expect(fetchSession("careers.foresitecapital.com")).rejects.toThrow(BoardNotFoundError);
    expect(state.calls).toBe(1);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("", { status: 500 })]);

    await expect(fetchSession("careers.foresitecapital.com")).rejects.toThrow(/500/);
    expect(state.calls).toBe(7);
  });

  test("a connection failure throws immediately without retrying (transient-load backoff only applies to 429/5xx)", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(fetchSession("careers.foresitecapital.com")).rejects.toThrow(/could not reach/);
  });
});
