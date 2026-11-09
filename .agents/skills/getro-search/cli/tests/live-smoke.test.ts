import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

// Live smoke test against the real jobs.menlovc.com Getro board (Step 4's mandatory
// live-query check, add-portal.md). Keep volume low: two requests total (one search, one
// detail), matching this skill's personal-use-only posture (SKILL.md).

const BOARD = "jobs.menlovc.com";

describe("live smoke test (jobs.menlovc.com)", () => {
  test("search returns real results with non-null id/title/url", async () => {
    const result = await runCLI([
      "search",
      "--board",
      BOARD,
      "-q",
      "business development",
      "--limit",
      "5",
    ]);

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);

    for (const r of data.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toBeTruthy();
      expect(typeof r.id).toBe("string");
    }
  }, 30000);

  test("detail on a live result returns a readable description", async () => {
    const search = await runCLI(["search", "--board", BOARD, "-q", "business development", "--limit", "1"]);
    const { results } = JSON.parse(search.stdout);
    expect(results.length).toBeGreaterThan(0);
    const id = results[0].id;

    const detail = await runCLI(["detail", id, "--board", BOARD, "--format", "plain"]);
    expect(detail.exitCode).toBe(0);
    expect(detail.stdout.length).toBeGreaterThan(100);
    // Plain output always ends with the apply URL line.
    expect(detail.stdout).toMatch(/Apply: https?:\/\//);
  }, 30000);
});
