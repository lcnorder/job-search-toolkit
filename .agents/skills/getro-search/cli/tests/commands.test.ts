import { afterEach, describe, expect, test } from "bun:test";
import { runSearch, type SearchOpts } from "../src/commands/search";
import { runDetail, type DetailOpts } from "../src/commands/detail";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
});

function captureStdout(): { get: () => string } {
  let out = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return { get: () => out };
}

function nextDataResponse(inner: unknown): Response {
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(inner)}</script>`;
  return new Response(html, { status: 200 });
}

function job(id: number, title: string, createdAt: number) {
  return {
    id,
    title,
    organization: { id: 1, name: "Acme", slug: "acme" },
    locations: ["Remote"],
    workMode: "remote",
    seniority: "senior",
    skills: [],
    url: `https://example.com/jobs/${id}`,
    slug: `${id}-${title.toLowerCase().replace(/\s+/g, "-")}`,
    createdAt,
  };
}

const baseSearchOpts: SearchOpts = {
  board: "jobs.menlovc.com",
  locations: [],
  seniority: [],
  workMode: [],
  facets: {},
  format: "json",
};

describe("runSearch", () => {
  test("--limit 0 emits zero results, exit code 0", async () => {
    globalThis.fetch = (async () =>
      nextDataResponse({
        props: { pageProps: { initialState: { jobs: { total: 1, found: [job(1, "Engineer", 1789047558)] } } } },
      })) as typeof fetch;

    const out = captureStdout();
    const code = await runSearch({ ...baseSearchOpts, limit: 0 });

    expect(code).toBe(0);
    expect(JSON.parse(out.get()).results).toHaveLength(0);
  });

  test("--jobage filters client-side to only recently-created jobs", async () => {
    const now = Date.now();
    const today = Math.floor(now / 1000);
    const longAgo = Math.floor((now - 30 * 86400000) / 1000);
    globalThis.fetch = (async () =>
      nextDataResponse({
        props: {
          pageProps: {
            initialState: {
              jobs: {
                total: 2,
                found: [job(1, "Fresh Role", today), job(2, "Stale Role", longAgo)],
              },
            },
          },
        },
      })) as typeof fetch;

    const out = captureStdout();
    const code = await runSearch({ ...baseSearchOpts, jobage: 1 });

    expect(code).toBe(0);
    const results = JSON.parse(out.get()).results;
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Fresh Role");
  });

  test("builds the request URL with q and a base64 filter for location", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return nextDataResponse({ props: { pageProps: { initialState: { jobs: { total: 0, found: [] } } } } });
    }) as typeof fetch;

    await runSearch({ ...baseSearchOpts, query: "engineer", locations: ["San Francisco, CA, USA"] });

    expect(capturedUrl).toContain("q=engineer");
    expect(capturedUrl).toContain("filter=");
    const filterParam = new URL(capturedUrl).searchParams.get("filter")!;
    const decoded = JSON.parse(Buffer.from(filterParam, "base64").toString("utf-8"));
    expect(decoded).toEqual({ searchable_locations: ["San Francisco, CA, USA"] });
  });

  test("a missing __NEXT_DATA__ payload fails loudly rather than returning an empty result set", async () => {
    // The exact failure mode hit live against jobs.a16z.com (not actually Getro).
    globalThis.fetch = (async () => new Response("<html>no next data</html>", { status: 200 })) as typeof fetch;

    const code = await runSearch(baseSearchOpts);
    expect(code).toBe(1);
  });

  test("a 404 board maps to BOARD_NOT_FOUND, not a crash", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
    const originalStderrWrite = process.stderr.write;
    let err = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      err += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    const code = await runSearch(baseSearchOpts);
    process.stderr.write = originalStderrWrite;

    expect(code).toBe(1);
    expect(JSON.parse(err).code).toBe("BOARD_NOT_FOUND");
  });
});

describe("runDetail", () => {
  test("fetches by numeric id using --board, resolving by id regardless of slug", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return nextDataResponse({
        props: {
          pageProps: {
            initialState: {
              jobs: {
                currentJob: {
                  id: 92787641,
                  title: "Solutions Engineer",
                  organization: { id: 1, name: "Carta", slug: "carta-com", industryTags: [] },
                  locations: [{ name: "London, UK" }],
                  url: "https://boards.greenhouse.io/carta/jobs/1",
                  slug: "92787641-solutions-engineer",
                  postedAt: "2026-09-10T13:39:18.889Z",
                  closedAt: null,
                  status: "active",
                  description: "<p>Hello</p>",
                  jobFunctions: [],
                  employmentTypes: [],
                },
              },
            },
          },
        },
      });
    }) as typeof fetch;

    const out = captureStdout();
    const opts: DetailOpts = { id: "92787641", board: "jobs.menlovc.com", format: "json" };
    const code = await runDetail(opts);

    expect(code).toBe(0);
    expect(capturedUrl).toContain("/companies/x/jobs/92787641-x");
    const result = JSON.parse(out.get());
    expect(result.id).toBe("92787641");
    expect(result.description).toBe("Hello");
  });

  test("infers --board from a full URL id", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response("", { status: 404 });
    }) as typeof fetch;

    await runDetail({ id: "https://jobs.accel.com/companies/x/jobs/42-x", format: "json" });
    expect(capturedUrl).toContain("jobs.accel.com");
  });

  test("a 404 maps to NOT_FOUND", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
    const originalStderrWrite = process.stderr.write;
    let err = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      err += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    const code = await runDetail({ id: "1", board: "jobs.menlovc.com", format: "json" });
    process.stderr.write = originalStderrWrite;

    expect(code).toBe(1);
    expect(JSON.parse(err).code).toBe("NOT_FOUND");
  });
});
