import { describe, test, expect } from "bun:test";
import { cleanContent, normalizeCompany, normalizeJobId, toResult, toDetail, type GreenhouseJob } from "../src/helpers";

function job(overrides: Partial<GreenhouseJob> = {}): GreenhouseJob {
  return {
    id: 4461450008,
    title: "Account Executive, AI Native",
    updated_at: "2026-08-21T21:32:54-04:00",
    first_published: "2024-12-20T13:53:38-05:00",
    absolute_url: "https://job-boards.greenhouse.io/anthropic/jobs/4461450008",
    location: { name: "New York City, NY; San Francisco, CA" },
    metadata: [{ id: 1, name: "Location Type", value: "On-Site", value_type: "single_select" }],
    requisition_id: "3356",
    internal_job_id: 4147866008,
    company_name: "Anthropic",
    ...overrides,
  };
}

describe("toResult — reshape into the portal-skill contract", () => {
  test("maps id/first_published/absolute_url", () => {
    const r = toResult(job(), "anthropic");
    expect(r.id).toBe(4461450008);
    expect(r.date).toBe("2024-12-20T13:53:38-05:00");
    expect(r.url).toBe("https://job-boards.greenhouse.io/anthropic/jobs/4461450008");
  });

  test("carries the required contract fields", () => {
    const r = toResult(job(), "anthropic");
    expect(r).toMatchObject({
      title: "Account Executive, AI Native",
      company: "Anthropic",
      location: "New York City, NY; San Francisco, CA",
    });
  });

  test("falls back to the --company slug when company_name is empty", () => {
    const r = toResult(job({ company_name: "" }), "anthropic");
    expect(r.company).toBe("anthropic");
  });

  test("missing values are null, not omitted", () => {
    const r = toResult(job({ location: null, first_published: null, requisition_id: null, metadata: null }), "anthropic");
    expect(r.location).toBeNull();
    expect(r.date).toBeNull();
    expect(r.requisition_id).toBeNull();
    expect(r.location_type).toBeNull();
  });

  test("description is null when content was not fetched", () => {
    const r = toResult(job(), "anthropic");
    expect(r.description).toBeNull();
  });

  test("description is populated (and cleaned) when content was fetched", () => {
    const r = toResult(job({ content: "&lt;p&gt;Hello&lt;/p&gt;" }), "anthropic");
    expect(r.description).toBe("Hello");
  });

  test("extracts the Location Type metadata facet", () => {
    const r = toResult(job(), "anthropic");
    expect(r.location_type).toBe("On-Site");
  });

  test("location_type is null when the company doesn't set that facet", () => {
    const r = toResult(job({ metadata: [{ id: 1, name: "Quota Coverage Type", value: "Full", value_type: "single_select" }] }), "gitlab");
    expect(r.location_type).toBeNull();
  });
});

describe("toDetail — adds departments/offices/metadata + cleaned description", () => {
  test("strips HTML and decodes double-escaped entities", () => {
    const d = toDetail(job({ content: "&lt;div&gt;Build APIs&lt;/div&gt;&lt;div&gt;&amp;nbsp;&lt;/div&gt;" }), "anthropic");
    expect(d.description).toBe("Build APIs");
  });

  test("maps departments and offices to name lists", () => {
    const d = toDetail(
      job({
        departments: [{ id: 1, name: "Sales" }],
        offices: [{ id: 2, name: "New York", location: "NY" }],
      }),
      "anthropic",
    );
    expect(d.departments).toEqual(["Sales"]);
    expect(d.offices).toEqual(["New York"]);
  });

  test("flattens metadata into a name -> value map", () => {
    const d = toDetail(job(), "anthropic");
    expect(d.metadata).toEqual({ "Location Type": "On-Site" });
  });

  test("empty departments/offices/metadata when absent", () => {
    const d = toDetail(job({ metadata: null }), "anthropic");
    expect(d.departments).toEqual([]);
    expect(d.offices).toEqual([]);
    expect(d.metadata).toEqual({});
  });
});

describe("cleanContent — Greenhouse's double-escaped HTML", () => {
  test("decodes entity-escaped tags before stripping them", () => {
    // Verified live against the real API: content's own markup is itself
    // HTML-entity-escaped, e.g. "&lt;div&gt;...&lt;/div&gt;" rather than
    // "<div>...</div>" — a naive tag-strip does nothing until this is decoded.
    expect(cleanContent("&lt;p&gt;One&lt;/p&gt;&lt;p&gt;Two&lt;/p&gt;")).toBe("One\nTwo");
  });

  test("decodes an entity revealed by the first decode pass (double-escaped &nbsp;)", () => {
    expect(cleanContent("&lt;div&gt;&amp;nbsp;&lt;/div&gt;")).toBeNull();
  });

  test("decodes hex numeric entities", () => {
    expect(cleanContent("Caf&amp;#xE9;")).toBe("Café");
  });

  test("returns null for empty input", () => {
    expect(cleanContent("")).toBeNull();
    expect(cleanContent(null)).toBeNull();
    expect(cleanContent(undefined)).toBeNull();
  });
});

describe("normalizeCompany", () => {
  test("trims whitespace", () => {
    expect(normalizeCompany("  anthropic  ")).toBe("anthropic");
  });
  test("rejects empty input", () => {
    expect(normalizeCompany("")).toBeNull();
    expect(normalizeCompany("   ")).toBeNull();
  });
});

describe("normalizeJobId", () => {
  test("accepts a bare numeric id", () => {
    expect(normalizeJobId("4461450008")).toBe("4461450008");
  });
  test("extracts the id from a /jobs/<id> URL", () => {
    expect(normalizeJobId("https://job-boards.greenhouse.io/anthropic/jobs/4461450008")).toBe("4461450008");
  });
  test("rejects a non-numeric string", () => {
    expect(normalizeJobId("not an id")).toBeNull();
    expect(normalizeJobId("")).toBeNull();
  });
});
