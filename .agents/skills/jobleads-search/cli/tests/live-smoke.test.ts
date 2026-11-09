import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

// Live smoke test against the real www.jobleads.com/us (Step 4's mandatory live-query
// check, add-portal.md). "business development" + "Denver CO" is used because it is the
// user's own specialty and a durable, high-volume query for this board. Keep volume low:
// one search fetch for the search check, one search fetch + one detail fetch for the
// detail check.

describe("live smoke test (www.jobleads.com/us)", () => {
  test("search returns real results with non-null id/title/url", async () => {
    const result = await runCLI(["search", "-q", "business development", "-l", "Denver CO", "--limit", "5"]);

    expect(result.exitCode).toBe(0);
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
