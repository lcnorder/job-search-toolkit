import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

// Live smoke test against real Consider boards (Step 4's mandatory live-query check,
// add-portal.md), now covering a second, independently-verified board to confirm the
// --board parametrization actually generalizes rather than only working by coincidence on
// the one board it was originally built against. Keep volume low: a handful of requests
// total per board, matching this skill's personal-use-only posture (SKILL.md).

const BOARD = "careers.foresitecapital.com";

// jobs.costanoavc.com (Costanoa Ventures) - confirmed live 2026-09-10 via the same platform
// check SKILL.md documents (window.serverInitialData + "Powered by Consider" footer link to
// product.consider.com). One of five candidates from a web-search-only list that turned out
// to genuinely be Consider - see SKILL.md's verified-boards table for the other three
// (careers.oneragtime.com, careers.setventures.com, careers.radiancapital.com) and the one
// that did NOT pan out (jobs.airtree.vc, which is actually Getro).
const SECOND_BOARD = "jobs.costanoavc.com";

// jobs.airtree.vc - AirTree Ventures was on the same reportedly-Consider candidate list, but
// turned out to run Getro (x-powered-by: Getro), not Consider - confirmed live 2026-09-10.
// Used here as the negative case: --board must fail loudly on a non-Consider host rather
// than silently returning wrong data.
const NON_CONSIDER_BOARD = "jobs.airtree.vc";

// fetchSession (helpers.ts) throws two distinct messages: "request failed: NNN ..." for a
// non-2xx HTTP response (a WAF/CDN block - e.g. Cloudflare challenging a shared CI runner's
// IP, outside this CLI's control), and a "could not find window.serverInitialData..."
// message when the page loads fine (200) but isn't actually Consider (a real platform-
// detection regression). Both currently surface as the same SEARCH_FAILED code, so this
// checks the message shape to tell the two apart rather than tolerating SEARCH_FAILED
// outright, which would also hide a genuine platform-detection break.
function isLikelyNetworkBlock(stderr: string): boolean {
  const err = JSON.parse(stderr);
  return err.code === "SEARCH_FAILED" && /^request failed: \d{3}/.test(err.error);
}

describe("live smoke test (careers.foresitecapital.com)", () => {
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

    if (result.exitCode !== 0) {
      expect(isLikelyNetworkBlock(result.stderr)).toBe(true);
      return;
    }
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);

    for (const r of data.results) {
      expect(r.id).toBeTruthy();
      expect(r.id).toMatch(/::/); // "<companySlug>::<jobId>" compound id - see helpers.ts
      expect(r.title).toBeTruthy();
      expect(r.url).toBeTruthy();
      expect(typeof r.id).toBe("string");
    }
  }, 30000);

  test("department filter narrows results server-side", async () => {
    const result = await runCLI([
      "search",
      "--board",
      BOARD,
      "--department",
      "Finance",
      "--limit",
      "5",
      "--format",
      "table",
    ]);
    if (result.exitCode !== 0) {
      expect(isLikelyNetworkBlock(result.stderr)).toBe(true);
      return;
    }
    expect(result.stdout).not.toBe("No results.");
  }, 30000);

  test("detail on a live result either returns a description or the documented NOT_HOSTED_BY_CONSIDER error", async () => {
    const search = await runCLI(["search", "--board", BOARD, "-q", "business development", "--limit", "1"]);
    if (search.exitCode !== 0) {
      expect(isLikelyNetworkBlock(search.stderr)).toBe(true);
      return;
    }
    const { results } = JSON.parse(search.stdout);
    expect(results.length).toBeGreaterThan(0);
    const id = results[0].id;

    const detail = await runCLI(["detail", id, "--board", BOARD, "--format", "plain"]);
    if (detail.exitCode === 0) {
      expect(detail.stdout.length).toBeGreaterThan(50);
      expect(detail.stdout).toMatch(/Apply: https?:\/\//);
    } else {
      // The large majority of Consider-board jobs route to an external ATS and are not
      // fetchable via Consider's own detail endpoint - this is a documented platform
      // limitation (SKILL.md), not a CLI bug, so a clean NOT_HOSTED_BY_CONSIDER is the
      // expected outcome here, not a test failure.
      const err = JSON.parse(detail.stderr);
      expect(err.code).toBe("NOT_HOSTED_BY_CONSIDER");
    }
  }, 30000);

  test("a bogus flag exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--not-a-real-flag", "x"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("UNKNOWN_FLAG");
  }, 15000);

  test("missing --board exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "-q", "engineer"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("NO_BOARD");
  }, 15000);
});

describe(`live smoke test on a second, independently-confirmed Consider board (${SECOND_BOARD})`, () => {
  // This is the multi-tenant regression check: the --board flag must work against a board
  // this skill was never specifically built against, using the exact same session/CSRF
  // handshake and parsing code path as careers.foresitecapital.com above.
  test("search returns real results with non-null id/title/url", async () => {
    const result = await runCLI(["search", "--board", SECOND_BOARD, "-q", "engineer", "--limit", "5"]);

    if (result.exitCode !== 0) {
      expect(isLikelyNetworkBlock(result.stderr)).toBe(true);
      return;
    }
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);

    for (const r of data.results) {
      expect(r.id).toBeTruthy();
      expect(r.id).toMatch(/::/);
      expect(r.title).toBeTruthy();
      expect(r.url).toBeTruthy();
    }
  }, 30000);

  test("detail on a live result either returns a description or the documented NOT_HOSTED_BY_CONSIDER error", async () => {
    const search = await runCLI(["search", "--board", SECOND_BOARD, "-q", "engineer", "--limit", "1"]);
    if (search.exitCode !== 0) {
      expect(isLikelyNetworkBlock(search.stderr)).toBe(true);
      return;
    }
    const { results } = JSON.parse(search.stdout);
    expect(results.length).toBeGreaterThan(0);
    const id = results[0].id;

    const detail = await runCLI(["detail", id, "--board", SECOND_BOARD, "--format", "plain"]);
    if (detail.exitCode === 0) {
      expect(detail.stdout.length).toBeGreaterThan(50);
      expect(detail.stdout).toMatch(/Apply: https?:\/\//);
    } else {
      const err = JSON.parse(detail.stderr);
      expect(err.code).toBe("NOT_HOSTED_BY_CONSIDER");
    }
  }, 30000);
});

describe(`negative test: a non-Consider board fails loudly rather than returning wrong data (${NON_CONSIDER_BOARD})`, () => {
  // jobs.airtree.vc looked like a plausible Consider board from the same web-search-derived
  // candidate list as SECOND_BOARD, but is actually Getro (x-powered-by: Getro header,
  // confirmed live) - the same "looks similar, isn't the same platform" trap documented in
  // getro-search/SKILL.md for jobs.a16z.com. --board must not silently return an empty or
  // wrong result set here.
  test("search fails with SEARCH_FAILED rather than returning empty/wrong results", async () => {
    const result = await runCLI(["search", "--board", NON_CONSIDER_BOARD, "-q", "engineer", "--limit", "5"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("SEARCH_FAILED");
    expect(err.error).toMatch(/serverInitialData/);
  }, 30000);
});
