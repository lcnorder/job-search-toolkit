import { afterEach, describe, expect, test } from "bun:test";
import { runSearch } from "../src/commands/search";
import { runDetail } from "../src/commands/detail";
import type { GreenhouseJob } from "../src/helpers";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;

function captureStdout(): { get: () => string } {
  let buf = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return { get: () => buf };
}

function captureStderr(): { get: () => string; restore: () => void } {
  let buf = "";
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  return { get: () => buf, restore: () => (process.stderr.write = original) };
}

/** Stub fetch with a canned response; the return value exposes the URL it was called with. */
function mockFetch(status: number, body: unknown): { url: () => string } {
  let requested = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { url: () => requested };
}

function job(overrides: Partial<GreenhouseJob> = {}): GreenhouseJob {
  return {
    id: 4461450008,
    title: "Account Executive, AI Native",
    updated_at: "2026-08-21T21:32:54-04:00",
    first_published: "2024-12-20T13:53:38-05:00",
    absolute_url: "https://job-boards.greenhouse.io/anthropic/jobs/4461450008",
    location: { name: "New York City, NY" },
    metadata: [{ id: 1, name: "Location Type", value: "On-Site", value_type: "single_select" }],
    requisition_id: "3356",
    internal_job_id: 4147866008,
    company_name: "Anthropic",
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
});

const baseSearchOpts = {
  company: "anthropic",
  page: 1,
  limit: 25,
  format: "json" as const,
  withDescription: false,
};

describe("runSearch (mocked fetch)", () => {
  test("emits the contract envelope with meta.count/page/total", async () => {
    mockFetch(200, { jobs: [job()] });
    const out = captureStdout();

    const code = await runSearch({ ...baseSearchOpts });
    expect(code).toBe(0);

    const parsed = JSON.parse(out.get());
    expect(parsed.meta).toEqual({ count: 1, page: 1, total: 1 });
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe(4461450008);
    expect(parsed.results[0].date).toBe("2024-12-20T13:53:38-05:00");
  });

  test("requests content=false by default", async () => {
    const mock = mockFetch(200, { jobs: [job()] });
    captureStdout();

    await runSearch({ ...baseSearchOpts });

    const url = new URL(mock.url());
    expect(url.pathname).toBe("/v1/boards/anthropic/jobs");
    expect(url.searchParams.get("content")).toBe("false");
  });

  test("requests content=true when withDescription is set", async () => {
    const mock = mockFetch(200, { jobs: [job({ content: "&lt;p&gt;Hi&lt;/p&gt;" })] });
    const out = captureStdout();

    await runSearch({ ...baseSearchOpts, withDescription: true });

    expect(new URL(mock.url()).searchParams.get("content")).toBe("true");
    expect(JSON.parse(out.get()).results[0].description).toBe("Hi");
  });

  test("filters client-side by query against the title", async () => {
    mockFetch(200, { jobs: [job({ id: 1, title: "Backend Engineer" }), job({ id: 2, title: "Recruiter" })] });
    const out = captureStdout();

    await runSearch({ ...baseSearchOpts, query: "engineer" });

    const parsed = JSON.parse(out.get());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe(1);
  });

  test("filters client-side by jobage against first_published", async () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    mockFetch(200, {
      jobs: [job({ id: 1, first_published: recent }), job({ id: 2, first_published: old })],
    });
    const out = captureStdout();

    await runSearch({ ...baseSearchOpts, jobage: 7 });

    const parsed = JSON.parse(out.get());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe(1);
  });

  test("a job missing first_published never matches a jobage filter", async () => {
    mockFetch(200, { jobs: [job({ id: 1, first_published: null })] });
    const out = captureStdout();

    await runSearch({ ...baseSearchOpts, jobage: 30 });

    expect(JSON.parse(out.get()).results).toHaveLength(0);
  });

  test("paginates client-side over the filtered list", async () => {
    const jobs = [1, 2, 3].map((n) =>
      job({ id: n, first_published: new Date(Date.now() - n * 1000).toISOString() }),
    );
    mockFetch(200, { jobs });
    const out = captureStdout();

    await runSearch({ ...baseSearchOpts, limit: 2, page: 2 });

    const parsed = JSON.parse(out.get());
    expect(parsed.meta).toEqual({ count: 1, page: 2, total: 3 });
    expect(parsed.results).toHaveLength(1);
  });

  test("a 404 (unknown company slug) is an error, not an empty result set", async () => {
    mockFetch(404, "");
    const err = captureStderr();
    const out = captureStdout();

    const code = await runSearch({ ...baseSearchOpts, company: "not-a-real-company-xyz" });
    err.restore();

    expect(code).toBe(1);
    expect(out.get()).toBe("");
    const parsed = JSON.parse(err.get());
    expect(parsed.code).toBe("UNKNOWN_COMPANY");
    expect(parsed.error).toContain("not-a-real-company-xyz");
  });

  test("network failure exits 1 with SEARCH_FAILED", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const err = captureStderr();

    const code = await runSearch({ ...baseSearchOpts });
    err.restore();

    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("SEARCH_FAILED");
  });
});

describe("runDetail (mocked fetch)", () => {
  test("prints the reshaped detail with a cleaned description", async () => {
    mockFetch(200, job({ content: "&lt;p&gt;Build things&lt;/p&gt;", departments: [{ id: 1, name: "Sales" }] }));
    const out = captureStdout();

    const code = await runDetail({ id: "4461450008", company: "anthropic", format: "json" });
    expect(code).toBe(0);

    const parsed = JSON.parse(out.get());
    expect(parsed.id).toBe(4461450008);
    expect(parsed.description).toBe("Build things");
    expect(parsed.departments).toEqual(["Sales"]);
  });

  test("404 exits 1 with NOT_FOUND", async () => {
    mockFetch(404, "");
    const err = captureStderr();

    const code = await runDetail({ id: "999999999", company: "anthropic", format: "json" });
    err.restore();

    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("NOT_FOUND");
  });
});
