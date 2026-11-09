import { afterEach, describe, expect, test } from "bun:test";
import { fetchSession } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise hang the CLI
// forever - fetch has no default timeout. Assert the request wrapper carries an AbortSignal
// timeout on every request, including the session-minting GET every command performs first.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchSession request timeout", () => {
  test("passes an AbortSignal timeout to fetch", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      const html = `<html><script>window.serverInitialData = {"csrfToken":"tok","board":{"id":"foresite-capital"}};</script></html>`;
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;

    await fetchSession("careers.foresitecapital.com");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
