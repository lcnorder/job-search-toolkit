import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// A real network smoke test against Anthropic's live Greenhouse board — per
// add-portal.md Step 3/4, a portal skill must be verified against real
// results, not just mocked ones. Keeps volume low: two live requests.

interface SearchResult {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  date: string | null;
  url: string;
}

interface SearchOutput {
  meta: { count: number; page: number; total: number };
  results: SearchResult[];
}

describe("live smoke test (network required)", () => {
  test("search --company anthropic returns real results", async () => {
    const result = await runCLI(["search", "--company", "anthropic", "-q", "engineer", "--limit", "5"]);
    expect(result.exitCode).toBe(0);

    const output = parseJSON<SearchOutput>(result);
    expect(output.results.length).toBeGreaterThan(0);

    for (const r of output.results) {
      expect(typeof r.id).toBe("number");
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.url).toStartWith("https://");
      expect(r.title.toLowerCase()).toContain("engineer");
    }
  }, 30000);

  test("detail fetches a real posting's full, readable description", async () => {
    const search = await runCLI(["search", "--company", "anthropic", "--limit", "1"]);
    const { results } = parseJSON<SearchOutput>(search);
    expect(results.length).toBeGreaterThan(0);
    const id = results[0].id;

    const detail = await runCLI(["detail", String(id), "--company", "anthropic", "--format", "plain"]);
    expect(detail.exitCode).toBe(0);
    // Readable text: no leftover HTML tags or entities.
    expect(detail.stdout).not.toMatch(/<[a-z][^>]*>/i);
    expect(detail.stdout).not.toMatch(/&(lt|gt|amp|nbsp|quot|#\d+);/);
    expect(detail.stdout.length).toBeGreaterThan(50);
  }, 30000);

  test("an unknown company slug is a clear error, not an empty result", async () => {
    const result = await runCLI(["search", "--company", "this-company-definitely-does-not-exist-xyz-123"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("UNKNOWN_COMPANY");
  }, 30000);
});
