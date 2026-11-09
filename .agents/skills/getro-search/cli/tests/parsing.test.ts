import { describe, test, expect } from "bun:test";
import {
  extractNextData,
  normalizeBoard,
  normalizeJobId,
  boardFromUrl,
  buildFilterParam,
  normalizeWorkMode,
  cleanHtml,
  toResult,
  toDetailResult,
  type GetroJobSummary,
  type GetroJobDetail,
} from "../src/helpers";

// A minimal but real-shaped __NEXT_DATA__ page, modeled on the live payload captured from
// jobs.menlovc.com/jobs during Step 2 investigation (url-reference.md).
function nextDataPage(inner: unknown): string {
  return `<!doctype html><html><body>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(inner)}</script>
  </body></html>`;
}

describe("extractNextData", () => {
  test("parses a well-formed __NEXT_DATA__ blob", () => {
    const html = nextDataPage({ props: { pageProps: { initialState: { jobs: { total: 3 } } } } });
    const data = extractNextData(html) as any;
    expect(data.props.pageProps.initialState.jobs.total).toBe(3);
  });

  test("throws a clear error when __NEXT_DATA__ is absent (e.g. a non-Getro board)", () => {
    // This is the exact failure mode hit live against jobs.a16z.com, which is NOT Getro
    // (see url-reference.md's "headline finding") - it must fail loudly, not silently
    // return an empty result set that looks like "no jobs matched".
    expect(() => extractNextData("<html><body>no next data here</body></html>")).toThrow(
      /__NEXT_DATA__/,
    );
  });

  test("throws a clear error when the blob is present but not valid JSON", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{not: valid}</script>`;
    expect(() => extractNextData(html)).toThrow(/JSON/);
  });
});

describe("normalizeBoard", () => {
  test("accepts a bare hostname", () => {
    expect(normalizeBoard("jobs.menlovc.com")).toBe("jobs.menlovc.com");
  });

  test("strips a leading https:// scheme", () => {
    expect(normalizeBoard("https://jobs.menlovc.com")).toBe("jobs.menlovc.com");
  });

  test("strips a leading http:// scheme and a trailing path", () => {
    expect(normalizeBoard("http://jobs.menlovc.com/jobs")).toBe("jobs.menlovc.com");
  });

  test("lowercases the host", () => {
    expect(normalizeBoard("Jobs.MenloVC.com")).toBe("jobs.menlovc.com");
  });

  test("rejects empty input", () => {
    expect(normalizeBoard("")).toBeNull();
    expect(normalizeBoard(undefined)).toBeNull();
  });

  test("rejects a value with no dot (not a hostname)", () => {
    expect(normalizeBoard("menlovc")).toBeNull();
  });

  test("rejects a value containing whitespace", () => {
    expect(normalizeBoard("jobs.menlovc.com evil.com")).toBeNull();
  });
});

describe("normalizeJobId", () => {
  test("accepts a bare numeric id", () => {
    expect(normalizeJobId("92787641")).toBe("92787641");
  });

  test("extracts the id from a full detail URL", () => {
    expect(
      normalizeJobId("https://jobs.menlovc.com/companies/carta-com/jobs/92787641-solutions-engineer"),
    ).toBe("92787641");
  });

  test("extracts the id even with placeholder/wrong slugs (Getro resolves by id alone)", () => {
    expect(normalizeJobId("https://jobs.menlovc.com/companies/x/jobs/92787641-x")).toBe("92787641");
  });

  test("rejects non-numeric, non-URL input", () => {
    expect(normalizeJobId("not-a-job")).toBeNull();
    expect(normalizeJobId("")).toBeNull();
  });
});

describe("boardFromUrl", () => {
  test("extracts the host from a full job URL", () => {
    expect(boardFromUrl("https://jobs.menlovc.com/companies/x/jobs/1-x")).toBe("jobs.menlovc.com");
  });

  test("returns null for a bare id (no scheme)", () => {
    expect(boardFromUrl("92787641")).toBeNull();
  });
});

describe("buildFilterParam", () => {
  function decode(b64: string): unknown {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  }

  test("returns null when no facets are given", () => {
    expect(buildFilterParam({})).toBeNull();
  });

  test("encodes searchable_locations as an array containing the whole string", () => {
    // Regression: a location string is itself comma-bearing free text
    // ("San Francisco, CA, USA"). It must stay ONE array element.
    const b64 = buildFilterParam({ locations: ["San Francisco, CA, USA"] })!;
    expect(decode(b64)).toEqual({ searchable_locations: ["San Francisco, CA, USA"] });
  });

  test("encodes seniority and work_mode under their confirmed snake_case keys", () => {
    const b64 = buildFilterParam({ seniority: ["senior"], workMode: ["remote"] })!;
    expect(decode(b64)).toEqual({ seniority: ["senior"], work_mode: ["remote"] });
  });

  test("merges extra --facet keys in as-is", () => {
    const b64 = buildFilterParam({ extra: { salary_min: ["100000"] } })!;
    expect(decode(b64)).toEqual({ salary_min: ["100000"] });
  });

  test("omits empty arrays rather than encoding them", () => {
    const b64 = buildFilterParam({ locations: [], seniority: ["senior"] })!;
    expect(decode(b64)).toEqual({ seniority: ["senior"] });
  });
});

describe("normalizeWorkMode", () => {
  test("maps onsite/on-site to Getro's on_site enum value", () => {
    expect(normalizeWorkMode("onsite")).toBe("on_site");
    expect(normalizeWorkMode("on-site")).toBe("on_site");
  });

  test("passes remote and hybrid through unchanged (already Getro's own values)", () => {
    expect(normalizeWorkMode("remote")).toBe("remote");
    expect(normalizeWorkMode("hybrid")).toBe("hybrid");
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

describe("toResult (search-page job -> contract shape)", () => {
  const job: GetroJobSummary = {
    id: 92787641,
    title: "Solutions Engineer",
    organization: { id: 9423, name: "Carta", slug: "carta-com" },
    locations: ["London, UK"],
    searchableLocations: ["London, UK", "United Kingdom"],
    workMode: "on_site",
    seniority: "mid_senior",
    skills: ["Fund Administration"],
    url: "https://boards.greenhouse.io/carta/jobs/7989778003",
    slug: "92787641-solutions-engineer",
    createdAt: 1789047558,
    compensationAmountMinCents: null,
    compensationAmountMaxCents: null,
    compensationCurrency: null,
    compensationPeriod: "period_not_defined",
  };

  test("maps id, title, company, location, url", () => {
    const r = toResult(job);
    expect(r.id).toBe("92787641");
    expect(r.title).toBe("Solutions Engineer");
    expect(r.company).toBe("Carta");
    expect(r.location).toBe("London, UK");
    expect(r.url).toBe("https://boards.greenhouse.io/carta/jobs/7989778003");
  });

  test("converts createdAt (epoch seconds) to an ISO date string", () => {
    const r = toResult(job);
    expect(r.date).toBe(new Date(1789047558 * 1000).toISOString());
  });

  test("description is always null on search results (not present on that page)", () => {
    expect(toResult(job).description).toBeNull();
  });

  test("falls back to searchableLocations[0] when locations is empty", () => {
    const noLoc: GetroJobSummary = { ...job, locations: [] };
    expect(toResult(noLoc).location).toBe("London, UK");
  });

  test("location is null when both locations and searchableLocations are empty", () => {
    const noLoc: GetroJobSummary = { ...job, locations: [], searchableLocations: [] };
    expect(toResult(noLoc).location).toBeNull();
  });

  test("formats a salary range when both min and max are present", () => {
    const paid: GetroJobSummary = {
      ...job,
      compensationAmountMinCents: 21350000,
      compensationAmountMaxCents: 26700000,
      compensationCurrency: "USD",
      compensationPeriod: "year",
    };
    expect(toResult(paid).salary).toBe("USD 213,500-267,000 / year");
  });

  test("salary is null when neither min nor max is present", () => {
    expect(toResult(job).salary).toBeNull();
  });
});

describe("toDetailResult (detail-page job -> contract shape)", () => {
  const job: GetroJobDetail = {
    id: 92787641,
    title: "Solutions Engineer",
    organization: {
      id: 9423,
      name: "Carta",
      slug: "carta-com",
      industryTags: [{ description: "Enterprise Software" }, { description: "Fintech" }],
    },
    locations: [{ name: "London, UK" }],
    url: "https://boards.greenhouse.io/carta/jobs/7989778003",
    slug: "92787641-solutions-engineer",
    postedAt: "2026-09-10T13:39:18.889Z",
    closedAt: null,
    status: "active",
    description: "<div><h2>The Company</h2><p>Carta is &amp; great.</p></div>",
    jobFunctions: [{ id: 5, name: "(Engineering)" }],
    employmentTypes: ["full_time"],
    compensationAmountMinCents: null,
    compensationAmountMaxCents: null,
    compensationCurrency: null,
    compensationPeriod: "period_not_defined",
  };

  test("maps postedAt straight through (already ISO 8601 on this page, unlike search)", () => {
    expect(toDetailResult(job).date).toBe("2026-09-10T13:39:18.889Z");
  });

  test("cleans the HTML description", () => {
    const d = toDetailResult(job).description!;
    expect(d).not.toContain("<h2>");
    expect(d).toContain("Carta is & great.");
  });

  test("joins multiple location names with a comma", () => {
    const multi: GetroJobDetail = { ...job, locations: [{ name: "London, UK" }, { name: "Remote" }] };
    expect(toDetailResult(multi).location).toBe("London, UK, Remote");
  });

  test("reads industryTags in the detail page's {description} object shape", () => {
    // Regression: organization.industryTags is string[] on the search page but
    // {description: string}[] on the detail page - toDetailResult must handle both.
    expect(toDetailResult(job).skills).toEqual(["Enterprise Software", "Fintech"]);
  });

  test("carries status, job functions, and employment types", () => {
    const r = toDetailResult(job);
    expect(r.status).toBe("active");
    expect(r.job_functions).toEqual(["(Engineering)"]);
    expect(r.employment_types).toEqual(["full_time"]);
  });
});
