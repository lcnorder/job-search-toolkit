import { afterEach, describe, expect, test } from "bun:test";
import { runSearch, type SearchOpts } from "../src/commands/search";
import { runDetail, type DetailOpts } from "../src/commands/detail";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

function captureStdout(): { get: () => string } {
  let out = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return { get: () => out };
}

function captureStderr(): { get: () => string } {
  let out = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    out += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  return { get: () => out };
}

const SESSION_HTML =
  '<html><script>window.serverInitialData = {"csrfToken":"tok-123","board":{"id":"foresite-capital","isParent":true}};</script></html>';

function job(jobId: string, title: string, timeStamp: string) {
  return {
    jobId,
    title,
    companyId: "Acme",
    companySlug: "acme",
    companyName: "Acme",
    locations: ["Remote"],
    remote: true,
    hybrid: false,
    jobSeniorities: [],
    requiredSkills: [],
    timeStamp,
    url: `https://example.com/jobs/${jobId}`,
    applyUrl: `https://example.com/jobs/${jobId}?src=careers.foresitecapital.com`,
  };
}

/** Routes a mocked fetch by URL/method: GET /jobs -> session page; POST /api-boards/search-jobs
 * -> the given search responder; GET /api-boards/jobs/<id> -> the given detail responder. */
function routedFetch(opts: {
  session?: () => Response;
  search?: (body: any) => unknown;
  detail?: () => unknown;
  onSearchCall?: (body: any) => void;
}): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api-boards/search-jobs")) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      opts.onSearchCall?.(body);
      return new Response(JSON.stringify(opts.search ? opts.search(body) : { jobs: [], total: 0 }), { status: 200 });
    }
    if (url.includes("/api-boards/jobs/")) {
      return new Response(JSON.stringify(opts.detail ? opts.detail() : {}), { status: 200 });
    }
    // GET /jobs - the session-minting page
    return opts.session ? opts.session() : new Response(SESSION_HTML, { status: 200 });
  }) as typeof fetch;
}

const baseSearchOpts: SearchOpts = {
  board: "careers.foresitecapital.com",
  locations: [],
  departments: [],
  extra: {},
  page: 1,
  format: "json",
};

describe("runSearch", () => {
  test("--limit 0 emits zero results, exit code 0", async () => {
    globalThis.fetch = routedFetch({
      search: () => ({ jobs: [job("1", "Engineer", "2026-09-09T00:00:00.000Z")], total: 1 }),
    });

    const out = captureStdout();
    const code = await runSearch({ ...baseSearchOpts, limit: 0 });

    expect(code).toBe(0);
    expect(JSON.parse(out.get()).results).toHaveLength(0);
  });

  test("builds the search-jobs request body from query/location/department/remote/jobage", async () => {
    let capturedBody: any;
    globalThis.fetch = routedFetch({
      search: () => ({ jobs: [], total: 0 }),
      onSearchCall: (body) => {
        capturedBody = body;
      },
    });

    await runSearch({
      ...baseSearchOpts,
      query: "engineer",
      locations: ["San Francisco, California"],
      departments: ["Finance"],
      remoteOnly: true,
      postedSince: "7d",
    });

    expect(capturedBody.query.keywords).toBe("engineer");
    expect(capturedBody.query.locations).toEqual(["San Francisco, California"]);
    expect(capturedBody.query.departments).toEqual(["Finance"]);
    expect(capturedBody.query.remoteOnly).toBe(true);
    expect(capturedBody.query.postedSince).toBe("7d");
    expect(capturedBody.board).toEqual({ id: "foresite-capital", isParent: true });
  });

  test("a missing window.serverInitialData payload fails loudly rather than returning an empty result set", async () => {
    // The exact failure mode hit live against jobs.airtree.vc (Getro, not Consider).
    globalThis.fetch = routedFetch({ session: () => new Response("<html>no data</html>", { status: 200 }) });

    const code = await runSearch(baseSearchOpts);
    expect(code).toBe(1);
  });

  test("a 404 board maps to BOARD_NOT_FOUND, not a crash", async () => {
    globalThis.fetch = routedFetch({ session: () => new Response("", { status: 404 }) });
    const err = captureStderr();

    const code = await runSearch(baseSearchOpts);

    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("BOARD_NOT_FOUND");
  });

  test("--page 2 walks the cursor chain: re-POSTs with the prior response's own meta.sequence", async () => {
    const bodies: any[] = [];
    let call = 0;
    globalThis.fetch = routedFetch({
      search: () => {
        call++;
        if (call === 1) {
          return { jobs: [job("1", "Page 1 job", "2026-09-09T00:00:00.000Z")], total: 40, meta: { sequence: "cursor-abc" } };
        }
        return { jobs: [job("2", "Page 2 job", "2026-09-08T00:00:00.000Z")], total: 40, meta: {} };
      },
      onSearchCall: (body) => bodies.push(body),
    });

    const out = captureStdout();
    const code = await runSearch({ ...baseSearchOpts, page: 2 });

    expect(code).toBe(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].meta.sequence).toBeUndefined();
    expect(bodies[1].meta.sequence).toBe("cursor-abc");
    const results = JSON.parse(out.get()).results;
    expect(results[0].title).toBe("Page 2 job");
  });
});

describe("runDetail", () => {
  test("fetches by the compound <companySlug>::<jobId> id and returns a cleaned description", async () => {
    let capturedUrl = "";
    globalThis.fetch = routedFetch({
      detail: () => ({
        job: {
          jobId: "abc123",
          title: "Solutions Engineer",
          companyId: "Carta",
          companySlug: "carta-com",
          companyName: "Carta",
          locations: ["London, UK"],
          remote: false,
          hybrid: false,
          jobSeniorities: [],
          requiredSkills: [],
          timeStamp: "2026-09-10T13:39:18.889Z",
          url: "https://boards.greenhouse.io/carta/jobs/1",
          description: "<p>Hello &amp; welcome</p>",
        },
      }),
    });
    // Wrap to also capture the URL of the detail GET specifically.
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api-boards/jobs/")) capturedUrl = url;
      return inner(input, init);
    }) as typeof fetch;

    const out = captureStdout();
    const opts: DetailOpts = { id: "carta-com::abc123", board: "careers.foresitecapital.com", format: "json" };
    const code = await runDetail(opts);

    expect(code).toBe(0);
    expect(capturedUrl).toContain("/api-boards/jobs/abc123");
    expect(capturedUrl).toContain("companyId=carta-com");
    const result = JSON.parse(out.get());
    expect(result.id).toBe("carta-com::abc123");
    expect(result.description).toBe("Hello & welcome");
  });

  test("an id with no '::' separator is rejected as BAD_ID before any network call", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const err = captureStderr();

    const code = await runDetail({ id: "not-compound", board: "careers.foresitecapital.com", format: "json" });

    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("BAD_ID");
    expect(fetchCalled).toBe(false);
  });

  test("an empty API response (no 'job' key) maps to NOT_HOSTED_BY_CONSIDER, not a crash", async () => {
    // The documented, expected outcome for the large majority of jobs on every Consider
    // board investigated - they route to an external ATS and Consider's own detail endpoint
    // returns no job data for them. See SKILL.md.
    globalThis.fetch = routedFetch({ detail: () => ({ version: {}, errors: [], debug: [] }) });
    const err = captureStderr();

    const code = await runDetail({ id: "acme::123", board: "careers.foresitecapital.com", format: "json" });

    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("NOT_HOSTED_BY_CONSIDER");
  });

  test("a 404 board (session fetch fails) maps to BOARD_NOT_FOUND", async () => {
    globalThis.fetch = routedFetch({ session: () => new Response("", { status: 404 }) });
    const err = captureStderr();

    const code = await runDetail({ id: "acme::123", board: "careers.foresitecapital.com", format: "json" });

    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("BOARD_NOT_FOUND");
  });
});
