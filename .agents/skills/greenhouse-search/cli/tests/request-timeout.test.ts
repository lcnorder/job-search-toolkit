import { afterEach, describe, expect, test } from "bun:test";
import { apiGet } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout. Assert the request
// wrapper carries an AbortSignal timeout.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("apiGet request timeout", () => {
  test("passes an AbortSignal timeout to fetch", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response(JSON.stringify({ jobs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await apiGet("/v1/boards/anthropic/jobs");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
