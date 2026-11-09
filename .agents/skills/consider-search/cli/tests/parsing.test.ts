import { afterEach, describe, test, expect } from "bun:test";
import {
  normalizeBoard,
  encodeCompoundId,
  decodeCompoundId,
  cleanHtml,
  toResult,
  fetchSession,
  BoardNotFoundError,
  type ConsiderJob,
} from "../src/helpers";

describe("normalizeBoard", () => {
  test("accepts a bare hostname", () => {
    expect(normalizeBoard("careers.foresitecapital.com")).toBe("careers.foresitecapital.com");
  });

  test("strips a leading https:// scheme", () => {
    expect(normalizeBoard("https://careers.foresitecapital.com")).toBe("careers.foresitecapital.com");
  });

  test("strips a leading http:// scheme and a trailing path", () => {
    expect(normalizeBoard("http://careers.foresitecapital.com/jobs")).toBe("careers.foresitecapital.com");
  });

  test("lowercases the host", () => {
    expect(normalizeBoard("Careers.ForesiteCapital.com")).toBe("careers.foresitecapital.com");
  });

  test("rejects empty input", () => {
    expect(normalizeBoard("")).toBeNull();
    expect(normalizeBoard(undefined)).toBeNull();
  });

  test("rejects a value with no dot (not a hostname)", () => {
    expect(normalizeBoard("foresitecapital")).toBeNull();
  });

  test("rejects a value containing whitespace", () => {
    expect(normalizeBoard("careers.foresitecapital.com evil.com")).toBeNull();
  });
});

describe("encodeCompoundId / decodeCompoundId", () => {
  test("round-trips a job's companySlug and jobId", () => {
    const job: ConsiderJob = { jobId: "dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e", title: "X", companySlug: "delfi-diagnostics" };
    const id = encodeCompoundId(job);
    expect(id).toBe("delfi-diagnostics::dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e");
    expect(decodeCompoundId(id)).toEqual({ companySlug: "delfi-diagnostics", jobId: "dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e" });
  });

  test("falls back to companyId when companySlug is absent", () => {
    const job: ConsiderJob = { jobId: "123", title: "X", companyId: "Delfi Diagnostics" };
    expect(encodeCompoundId(job)).toBe("Delfi Diagnostics::123");
  });

  test("falls back to 'unknown' when neither slug nor id is present", () => {
    const job: ConsiderJob = { jobId: "123", title: "X" };
    expect(encodeCompoundId(job)).toBe("unknown::123");
  });

  test("decodeCompoundId rejects an id with no '::' separator", () => {
    expect(decodeCompoundId("not-a-compound-id")).toBeNull();
    expect(decodeCompoundId("")).toBeNull();
  });

  test("decodeCompoundId rejects an id with nothing after the separator", () => {
    expect(decodeCompoundId("acme::")).toBeNull();
  });

  test("decodeCompoundId rejects an id with nothing before the separator", () => {
    expect(decodeCompoundId("::123")).toBeNull();
  });

  test("decodeCompoundId handles a jobId that itself is numeric (Greenhouse-sourced)", () => {
    expect(decodeCompoundId("myome::4398267009")).toEqual({ companySlug: "myome", jobId: "4398267009" });
  });
});

describe("cleanHtml", () => {
  test("strips tags and decodes entities", () => {
    expect(cleanHtml("<p>Caf&#xE9; &amp; Co</p>")).toBe("Café & Co");
  });

  test("converts block-level closing tags into newlines", () => {
    const html = "<div><h2>Role</h2><p>First.</p><ul><li>A</li><li>B</li></ul></div>";
    const text = cleanHtml(html)!;
    expect(text).toContain("Role");
    expect(text).toContain("First.");
    expect(text.split("\n").filter(Boolean).length).toBeGreaterThan(1);
  });

  test("returns null for empty or missing input", () => {
    expect(cleanHtml(null)).toBeNull();
    expect(cleanHtml(undefined)).toBeNull();
    expect(cleanHtml("")).toBeNull();
  });
});

describe("toResult (search-result job -> contract shape)", () => {
  const job: ConsiderJob = {
    jobId: "dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e",
    title: "Accounting Operations Manager",
    companyId: "Delfi Diagnostics",
    companySlug: "delfi-diagnostics",
    companyName: "Delfi Diagnostics",
    departments: ["Finance"],
    locations: ["Palo Alto, CA"],
    remote: false,
    hybrid: false,
    jobSeniorities: [{ id: "manager", label: "Manager/Senior Manager", value: "manager" }],
    requiredSkills: [{ id: "resume:FDA", label: "FDA", value: "resume:FDA" }],
    timeStamp: "2026-09-09T23:11:01.621000Z",
    url: "https://jobs.lever.co/delfidiagnostics/dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e",
    applyUrl: "https://jobs.lever.co/delfidiagnostics/dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e?lever-source%5B%5D=careers.foresitecapital.com",
  };

  test("maps id as the compound companySlug::jobId form", () => {
    expect(toResult(job).id).toBe("delfi-diagnostics::dfc8cada-f1f4-4209-9a0a-5bfc0ae02a5e");
  });

  test("prefers companyName over companyId", () => {
    expect(toResult(job).company).toBe("Delfi Diagnostics");
    const noName: ConsiderJob = { ...job, companyName: null };
    expect(toResult(noName).company).toBe("Delfi Diagnostics"); // falls back to companyId
  });

  test("joins multiple locations with a comma", () => {
    const multi: ConsiderJob = { ...job, locations: ["Palo Alto, CA", "Remote"] };
    expect(toResult(multi).location).toBe("Palo Alto, CA, Remote");
  });

  test("location is null when locations is empty or absent", () => {
    expect(toResult({ ...job, locations: [] }).location).toBeNull();
  });

  test("date passes timeStamp straight through (already ISO 8601, no conversion)", () => {
    expect(toResult(job).date).toBe("2026-09-09T23:11:01.621000Z");
  });

  test("prefers applyUrl over url (carries Consider's own source-attribution param)", () => {
    expect(toResult(job).url).toBe(job.applyUrl);
    const noApply: ConsiderJob = { ...job, applyUrl: undefined };
    expect(toResult(noApply).url).toBe(job.url);
  });

  test("description is always null on search results", () => {
    expect(toResult(job).description).toBeNull();
  });

  test("derives work_mode from remote/hybrid booleans", () => {
    expect(toResult({ ...job, remote: true, hybrid: false }).work_mode).toBe("remote");
    expect(toResult({ ...job, remote: false, hybrid: true }).work_mode).toBe("hybrid");
    expect(toResult({ ...job, remote: false, hybrid: false }).work_mode).toBe("on_site");
    expect(toResult({ ...job, remote: undefined, hybrid: undefined }).work_mode).toBeNull();
  });

  test("joins jobSeniorities labels for the seniority field", () => {
    const multi: ConsiderJob = {
      ...job,
      jobSeniorities: [
        { label: "Director" },
        { label: "Senior Director" },
      ],
    };
    expect(toResult(multi).seniority).toBe("Director, Senior Director");
  });

  test("seniority is null when jobSeniorities is empty", () => {
    expect(toResult({ ...job, jobSeniorities: [] }).seniority).toBeNull();
  });

  test("maps requiredSkills labels into skills", () => {
    expect(toResult(job).skills).toEqual(["FDA"]);
  });

  test("formats a salary range when both min and max are present", () => {
    const paid: ConsiderJob = {
      ...job,
      salary: { minValue: 140000, maxValue: 175000, currency: { value: "USD" }, period: { value: "year" } },
    };
    expect(toResult(paid).salary).toBe("USD 140,000-175,000 / year");
  });

  test("salary is null when no salary object is present", () => {
    expect(toResult(job).salary).toBeNull();
  });
});

describe("fetchSession (window.serverInitialData extraction)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function pageResponse(inner: unknown, status = 200): Response {
    const html = `<html><body><script>window.serverInitialData = ${JSON.stringify(inner)};</script></body></html>`;
    return new Response(html, {
      status,
      headers: { "set-cookie": "session=abc123; path=/" },
    });
  }

  test("extracts csrfToken, board.id, and a cookie header from a well-formed page", async () => {
    globalThis.fetch = (async () =>
      pageResponse({ csrfToken: "tok-123", board: { id: "foresite-capital", isParent: true } })) as typeof fetch;

    const session = await fetchSession("careers.foresitecapital.com");
    expect(session.csrfToken).toBe("tok-123");
    expect(session.boardId).toBe("foresite-capital");
  });

  test("throws a clear error when window.serverInitialData is absent (e.g. a non-Consider board)", async () => {
    // The exact failure mode hit live against jobs.airtree.vc, which turned out to be
    // Getro, not Consider - it must fail loudly, not silently return empty results.
    globalThis.fetch = (async () => new Response("<html><body>no data here</body></html>", { status: 200 })) as typeof fetch;

    await expect(fetchSession("jobs.airtree.vc")).rejects.toThrow(/serverInitialData/);
  });

  test("throws a clear error when the blob is present but not valid JSON", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><script>window.serverInitialData = {not: valid};</script></html>", { status: 200 })) as typeof fetch;

    await expect(fetchSession("careers.foresitecapital.com")).rejects.toThrow(/could not parse/);
  });

  test("throws a clear error when csrfToken or board.id is missing", async () => {
    globalThis.fetch = (async () => pageResponse({ board: { id: "foresite-capital" } })) as typeof fetch;

    await expect(fetchSession("careers.foresitecapital.com")).rejects.toThrow(/csrfToken|board.id/);
  });

  test("a 404 board maps to BoardNotFoundError, not a crash", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;

    await expect(fetchSession("careers.foresitecapital.com")).rejects.toThrow(BoardNotFoundError);
  });
});
