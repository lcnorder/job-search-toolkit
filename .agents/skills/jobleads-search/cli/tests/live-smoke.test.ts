import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

// Live smoke test against the real www.jobleads.com/us (Step 4's mandatory live-query
// check, add-portal.md). "business development" + "Denver CO" is used because it is the
// user's own specialty and a durable, high-volume query for this board. Keep volume low:
// one search fetch for the search check, one search fetch + one detail fetch for the
// detail check.

// textFetch (helpers.ts) throws "Request failed: NNN" for any non-404 4xx/5xx response - a
// WAF/CDN block (e.g. Cloudflare challenging a shared CI runner's IP) typically shows up
// this way. runSearch's catch-all wraps that in SEARCH_FAILED, the same code a genuine
// parsing bug would also produce, so this checks the message shape to tell a network block
// apart from a real regression rather than tolerating SEARCH_FAILED outright.
function isLikelyNetworkBlock(stderr: string): boolean {
  const err = JSON.parse(stderr);
  return err.code === "SEARCH_FAILED" && /^Request failed: \d+/.test(err.error);
}

describe("live smoke test (www.jobleads.com/us)", () => {
  test("search returns real results with non-null id/title/url", async () => {
    const result = await runCLI(["search", "-q", "business development", "-l", "Denver CO", "--limit", "5"]);

    if (result.exitCode !== 0) {
      expect(isLikelyNetworkBlock(result.stderr)).toBe(true);
      return;
    }

    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);

    for (const r of data.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toBeTruthy();
      expect(typeof r.id).toBe("string");
      expect(r.url).toContain("jobleads.com/us/job/");
    }
  }, 60000);

  test("detail on a live result returns readable fields (or a clean DETAIL_BLOCKED if Cloudflare ever challenges it)", async () => {
    const search = await runCLI(["search", "-q", "business development", "-l", "Denver CO", "--limit", "1"]);
    if (search.exitCode !== 0) {
      // Can't exercise detail without a live search result first; a network block on the
      // prerequisite search is itself a pass here, for the same reason as the test above.
      expect(isLikelyNetworkBlock(search.stderr)).toBe(true);
      return;
    }
    const { results } = JSON.parse(search.stdout);
    expect(results.length).toBeGreaterThan(0);
    const url = results[0].url;

    const detail = await runCLI(["detail", url, "--format", "plain"]);

    if (detail.exitCode === 0) {
      expect(detail.stdout.length).toBeGreaterThan(20);
      expect(detail.stdout).toMatch(/URL: https?:\/\//);
    } else {
      // Cloudflare's scoring of this client is its own and could change at any time (see
      // helpers.ts) - if it ever does challenge this request, the CLI must report it
      // cleanly rather than crash, and that clean failure is itself a pass here.
      const err = JSON.parse(detail.stderr);
      expect(err.code).toBe("DETAIL_BLOCKED");
    }
  }, 60000);
});
